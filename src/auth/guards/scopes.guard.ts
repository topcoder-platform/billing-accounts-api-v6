// src/auth/guards/scopes.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

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
    if (!user) throw new ForbiddenException('Missing authUser');

    // Scopes can be array (scopes) or space-delimited string (scope)
    const scopes: string[] = Array.isArray(user.scopes)
      ? user.scopes
      : (user.scope || '').split(' ').map((s: string) => s.trim()).filter(Boolean);

    const ok = required.every((s) => scopes.includes(s));
    if (!ok) throw new ForbiddenException('Missing required scope(s)');
    return true;
  }
}
