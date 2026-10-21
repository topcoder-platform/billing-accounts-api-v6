import { auth } from 'tc-core-library-js';
// src/auth/guards/scopes.guard.ts
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
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Evaluates context metadata; returns access or throws ForbiddenException on denial. */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.authUser;
    if (!user) throw new ForbiddenException("Missing authUser");

    if (auth.hasScopes(user, required, 'any')) return true;

    const fallbackRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (user.kind === 'user' && fallbackRoles && fallbackRoles.length > 0) {
      const roles: string[] = Array.isArray(user.roles)
        ? user.roles
        : (user.roles || user.role || "")
            .split(",")
            .map((r: string) => r.trim())
            .filter(Boolean);

      const normalizedFallbackRoles = fallbackRoles.map((role) =>
        role.trim().toLowerCase(),
      );
      const normalizedRoles = roles.map((role: string) =>
        role.trim().toLowerCase(),
      );

      const roleOk = normalizedRoles.some((role: string) =>
        normalizedFallbackRoles.includes(role),
      );
      if (roleOk) return true;
    }

    throw new ForbiddenException("Missing required role or scope");
  }
}
