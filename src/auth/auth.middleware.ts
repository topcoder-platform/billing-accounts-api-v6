import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { middleware } from 'tc-core-library-js';

/** Uses the common validator for member and Keycloak service principals on HTTP requests. */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly authenticator: ReturnType<typeof middleware.jwtAuthenticator>;

  /**
   * Initializes explicit Keycloak configuration and configured member trust.
   * Uses process environment configuration; takes no arguments.
   * @throws Error when shared authentication configuration is invalid.
   */
  constructor() {
    const configuredIssuers = process.env.VALID_ISSUERS || '[]';
    const issuers = configuredIssuers.trim().startsWith('[')
      ? configuredIssuers
      : JSON.stringify(configuredIssuers.split(',').map(value => value.trim()));
    this.authenticator = middleware.jwtAuthenticator({
      AUTH_SECRET: process.env.AUTH_SECRET,
      VALID_ISSUERS: issuers,
    });
  }

  /**
   * Attaches a verified principal when a bearer header is present; public routes remain anonymous.
   * @param req Request containing the bearer header.
   * @param res Response passed to the shared middleware.
   * @param next Express continuation receiving sanitized authentication failures.
   * @returns Nothing; continues through next. Invalid tokens yield UnauthorizedException.
   */
  use(req: Request, res: Response, next: NextFunction): void {
    const candidates = [req.headers.authorization];
    const authorization = candidates.flatMap(value => value || []).find(Boolean);
    if (!authorization) { next(); return; }
    req.headers.authorization = authorization;
    this.authenticator(req, res, (error?: Error) => {
      next(error ? new UnauthorizedException('Invalid authentication token.') : undefined);
    });
  }
}
