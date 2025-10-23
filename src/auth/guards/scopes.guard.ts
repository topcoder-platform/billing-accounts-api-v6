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

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.authUser;
    if (!user) throw new ForbiddenException("Missing authUser");

    // Scopes can be array (scopes) or space-delimited string (scope)
    const scopes: string[] = Array.isArray(user.scopes)
      ? user.scopes
      : (user.scope || "")
          .split(" ")
          .map((s: string) => s.trim())
          .filter(Boolean);

    const ok = required.every((s) => scopes.includes(s));
    if (ok) return true;

    const fallbackRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (fallbackRoles && fallbackRoles.length > 0) {
      const roles: string[] = Array.isArray(user.roles)
        ? user.roles
        : (user.roles || user.role || "")
            .split(",")
            .map((r: string) => r.trim())
            .filter(Boolean);

      const roleOk = roles.some((r: string) => fallbackRoles.includes(r));
      if (roleOk) return true;
    }

    throw new ForbiddenException("Missing required role or scope");
  }
}
