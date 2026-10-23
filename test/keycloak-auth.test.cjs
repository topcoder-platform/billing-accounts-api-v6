/* Synthetic local authentication boundary checks; no real secrets or network calls. */
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { AuthMiddleware } = require('../dist/auth/auth.middleware');

Object.assign(process.env, {
  USE_KEYCLOAK: 'true',
  KEYCLOAK_ISSUER: 'https://keycloak.example.test/realms/test',
  KEYCLOAK_AUDIENCE: 'https://api.example.test',
  KEYCLOAK_TOKEN_URL: 'https://keycloak.example.test/m2m/token',
  VALID_ISSUERS: '["https://members.example.test"]',
  AUTH_SECRET: 'synthetic-unit-test-key',
  ALLOW_LEGACY_USER_AUDIENCE: 'true',
});

/** Signs supplied synthetic claims with a test HMAC key; returns a JWT; throws for invalid JSON data. */
function signed(claims, secret = process.env.AUTH_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://members.example.test', sub: '42',
    userId: 42, roles: ['Member'], iat: now, exp: now + 120, ...claims })).toString('base64url');
  const value = `${header}.${body}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

/** Runs the compiled HTTP adapter with a supplied token; returns the principal or rejects on authentication failure. */
function authenticate(token) {
  const request = { headers: { authorization: `Bearer ${token}` } };
  return new Promise((resolve, reject) => {
    new AuthMiddleware(new ConfigService(process.env)).use(request, {}, error => {
      if (error) reject(error); else resolve(request.authUser);
    });
  });
}

test('member OAuth scopes cannot create a service identity', async () => {
  const user = await authenticate(signed({ scope: 'read:groups write:bus_api' }));
  assert.equal(user.kind, 'user');
  assert.equal(user.isMachine, false);
  assert.equal(user.userId, 42);
  assert.deepEqual(user.scopes, []);
});

test('invalid signatures and machine-like member claims are rejected', async () => {
  await assert.rejects(authenticate(signed({}, 'wrong-key')));
  await assert.rejects(authenticate(signed({ gty: 'client-credentials', azp: 'm2m-test' })));
  await assert.rejects(authenticate(signed({ isMachine: true })));
});

test('Keycloak issuer cannot authenticate using the member HMAC key', async () => {
  await assert.rejects(authenticate(signed({ iss: process.env.KEYCLOAK_ISSUER,
    gty: 'client-credentials', azp: 'm2m-test', scope: 'read:groups',
    aud: process.env.KEYCLOAK_AUDIENCE, userId: undefined, roles: undefined })));
});

const { ScopesGuard } = require('../dist/auth/guards/scopes.guard');

/** Builds a route context from a supplied normalized principal; returns a local fixture without I/O or exceptions. */
function context(authUser) {
  return { getHandler: () => context, getClass: () => ScopesGuard,
    switchToHttp: () => ({ getRequest: () => ({ authUser }) }) };
}

/** Checks a guard denial for the supplied principal, accepting false or ForbiddenException; throws if access was granted. */
function denied(guard, user) {
  let allowed = false;
  try { allowed = guard.canActivate(context(user)); } catch (error) {
    assert.equal(error.getStatus(), 403);
  }
  assert.equal(allowed, false);
}

test('route scopes are exact and never grant member access', () => {
  const guard = new ScopesGuard({ getAllAndOverride: key => key === 'scopes' ? ['read:test'] : undefined });
  assert.equal(guard.canActivate(context({ kind: 'service', isMachine: true, scopes: ['read:test'] })), true);
  denied(guard, { kind: 'service', isMachine: true, scopes: ['READ:TEST'] });
  denied(guard, { kind: 'service', isMachine: true, scopes: ['write:test'] });
  denied(guard, { kind: 'user', isMachine: false, scopes: ['read:test'], roles: [] });
});

/** Constructs the compiled middleware with the given overrides and no other Keycloak settings; throws on invalid configuration. */
function startWith(overrides) {
  const saved = { ...process.env };
  for (const name of ['USE_KEYCLOAK', 'KEYCLOAK_ISSUER', 'KEYCLOAK_AUDIENCE', 'KEYCLOAK_TOKEN_URL']) {
    delete process.env[name];
  }
  Object.assign(process.env, overrides);
  try { return new AuthMiddleware(new ConfigService(process.env)); } finally { process.env = saved; }
}

test('USE_KEYCLOAK=false or unset starts without Keycloak settings and accepts Auth0 machine trust', () => {
  assert.doesNotThrow(() => startWith({ USE_KEYCLOAK: 'false' }));
  assert.doesNotThrow(() => startWith({}));
  assert.doesNotThrow(() => startWith({ USE_KEYCLOAK: 'false',
    LEGACY_M2M_ISSUERS: '["https://members.example.test"]', LEGACY_M2M_AUDIENCE: 'https://m2m.example.test/' }));
});

test('USE_KEYCLOAK=true requires the Keycloak settings; other values fail fast', () => {
  assert.throws(() => startWith({ USE_KEYCLOAK: 'true' }), TypeError);
  assert.doesNotThrow(() => startWith({ USE_KEYCLOAK: 'TRUE', KEYCLOAK_ISSUER: 'https://keycloak.example.test/realms/test',
    KEYCLOAK_AUDIENCE: 'https://api.example.test', KEYCLOAK_TOKEN_URL: 'https://keycloak.example.test/m2m/token' }));
  assert.throws(() => startWith({ USE_KEYCLOAK: 'keycloak' }), /USE_KEYCLOAK must be true or false/);
});
