import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

// tc-core-library-js is CommonJS only, import via require

const tcCore = require("tc-core-library-js");

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private jwtAuthenticator: any;

  constructor() {
    // The library exposes middleware.jwtAuthenticator(AUTH_SECRET?) and will attach req.authUser
    // See appirio-tech/tc-core-library-js README for details.
    const secret = process.env.AUTH_SECRET;
    const validIssuers =
      process.env.VALID_ISSUERS ||
      '["https://api.topcoder.com","https://topcoder-dev.auth0.com/"]';
    this.jwtAuthenticator = tcCore.middleware.jwtAuthenticator({
      AUTH_SECRET: secret,
      VALID_ISSUERS: validIssuers,
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    // If no Authorization header is present, continue (many GET endpoints may be public).
    // Controllers/guards can still enforce roles/scopes where required.
    if (!req.headers["authorization"]) {
      return next();
    }
    return this.jwtAuthenticator(req, res, next);
  }
}
