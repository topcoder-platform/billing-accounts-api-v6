import { auth } from 'tc-core-library-js';
// src/auth/guards/roles.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { SCOPES_KEY } from "../decorators/scopes.decorator";

/** Applies route role/scope alternatives to the shared verified principal; scopes are exact. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Evaluates context metadata; returns access or throws ForbiddenException on denial. */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const normalizedRequiredRoles = required.map((role) =>
      role.trim().toLowerCase(),
    );

    const req = context.switchToHttp().getRequest();
    const user = req.authUser;
    if (!user) throw new ForbiddenException("Missing authUser");

    // roles might be array or comma-separated string depending on token source
    const roles: string[] = Array.isArray(user.roles)
      ? user.roles
      : (user.roles || user.role || "")
          .split(",")
          .map((r: string) => r.trim())
          .filter(Boolean);
    const normalizedRoles = roles.map((role) => role.toLowerCase());

    const ok = normalizedRoles.some((role: string) =>
      normalizedRequiredRoles.includes(role),
    );
    if (user.kind === 'user' && ok) return true;

    const fallbackScopes = this.reflector.getAllAndOverride<string[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (fallbackScopes?.length && auth.hasScopes(user, fallbackScopes, 'any')) {
      return true;
    }

    throw new ForbiddenException("Insufficient role or scope");
  }
}
