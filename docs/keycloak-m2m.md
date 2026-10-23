# Keycloak M2M migration branch

This code is isolated on `keycloak_m2M`. Do not deploy this branch until the
workload and its callers are ready. Existing DEV services continue using Auth0.
The core dependency is pinned to a reviewed Keycloak prerelease commit, including
transitive wrapper uses through the pnpm override. No npm latest dependency is used.
`pnpm-lock.yaml` resolves a single 4.0.0-keycloak.1 (core commit `e844764`).

## Provider switch: `USE_KEYCLOAK`

Billing Accounts only validates incoming tokens; it never requests Topcoder M2M
tokens (Salesforce uses its own `SALESFORCE_*` credentials), so it needs no M2M client
credentials in either mode. `USE_KEYCLOAK` selects which machine tokens the shared
validator is built for:

- `true`: Keycloak machine tokens are accepted. `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`
  and `KEYCLOAK_TOKEN_URL` are required and missing values fail at startup. Auth0
  machine tokens are also accepted while `LEGACY_M2M_ISSUERS`/`LEGACY_M2M_AUDIENCE`
  are set.
- unset or `false`: no Keycloak setting is required. Auth0 machine tokens are accepted
  through `LEGACY_M2M_ISSUERS` (a subset of `VALID_ISSUERS`) and `LEGACY_M2M_AUDIENCE`,
  plus Keycloak tokens while `KEYCLOAK_ISSUER` and `KEYCLOAK_AUDIENCE` are set, so
  callers that have not switched yet keep working.

`tc-core-library-js` reads the flag, so the service and the core always agree. Any
value other than `true`/`false` fails at startup. In DEV the flag is
`/config/common/global-appvar/USE_KEYCLOAK`; the CircleCI deploy loads that path with
`/config/billing-accounts-api-v6/appvar`, so no deploy change is needed.

**Rollback:** set `USE_KEYCLOAK=false` and force a new deployment so tasks re-read SSM.
No code or dependency change is needed. Keep `LEGACY_M2M_ISSUERS` and
`LEGACY_M2M_AUDIENCE` in SSM until Keycloak has been accepted, or Auth0 callers are
rejected in Auth0 mode.

The DEV issuer is `https://keycloak.topcoder-dev.com/realms/topcoder-m2m-dev`,
audience `https://api.topcoder-dev.com`, and managed endpoint
`https://keycloak.topcoder-dev.com/m2m/token`. The managed endpoint passed DEV deployment acceptance on 21 October 2026.

Member sessions remain Auth0. Keep `VALID_ISSUERS` and `AUTH_SECRET` where legacy
member HMAC tokens are supported. Set `AUTH_USER_AUDIENCES` to a JSON array, or
explicitly retain existing user-token audience behavior with
`ALLOW_LEGACY_USER_AUDIENCE=true`. Never apply that exception to M2M tokens.
`LEGACY_M2M_ISSUERS` and `LEGACY_M2M_AUDIENCE` let Auth0 machine tokens pass the same
normalizer (see the provider switch above).

`tc-core-library-js` owns signature, issuer, audience, lifetime, and machine/user
classification. Service adapters must use its verified `kind`, `isMachine`, and
`scopes` rather than decode/reclassify claims. Scope guards delegate exact matching
to the library with explicit all/any policy. Existing business roles and documented
scope aliases remain endpoint policy; adding OAuth scopes to a user token never
grants machine access. No permissive fallback or synthetic token path is available.

Before rollout run this project's `nvm use`, `pnpm lint`, `pnpm build`, and targeted
authentication tests. Validate real authorized/unauthorized routes with both a
Keycloak service token and a member token, including wrong audiences and insufficient
scopes. Switch only after every downstream receiver accepts the issuer. Rolling back
is the explicit `USE_KEYCLOAK=false` change above.


Run `pnpm test:keycloak` after building to exercise the compiled HTTP adapter with
synthetic signed member tokens, forged machine claims, invalid signatures, and the
`USE_KEYCLOAK` startup rules for both modes.

Validation on 23 October 2026: Lint/build and six compiled authentication checks pass. No pre-existing unit-test script is defined.
