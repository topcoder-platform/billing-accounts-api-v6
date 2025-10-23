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

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

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

    const ok = roles.some((r: string) => required.includes(r));
    if (ok) return true;

    const fallbackScopes = this.reflector.getAllAndOverride<string[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (fallbackScopes && fallbackScopes.length > 0) {
      const scopes: string[] = Array.isArray(user.scopes)
        ? user.scopes
        : (user.scope || "")
            .split(" ")
            .map((s: string) => s.trim())
            .filter(Boolean);

      const scopeOk = fallbackScopes.every((s) => scopes.includes(s));
      if (scopeOk) return true;
    }

    throw new ForbiddenException("Insufficient role or scope");
  }
}
