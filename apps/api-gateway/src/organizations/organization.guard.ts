import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthenticatedUser,
  BadRequestAppException,
  ForbiddenAppException,
  IS_PUBLIC_KEY,
} from '@app/common';
import { AUTH_PATTERNS } from '@app/contracts';
import type { OrganizationView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { SKIP_ORG_KEY } from './skip-org.decorator';

export const ORGANIZATION_HEADER = 'x-organization-id';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly proxy: MicroserviceProxy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const skipOrg = this.reflector.getAllAndOverride<boolean>(SKIP_ORG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || skipOrg) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      headers: Record<string, string | string[] | undefined>;
      organization?: OrganizationView;
    }>();

    if (!request.user?.id) {
      return true;
    }

    const raw = request.headers[ORGANIZATION_HEADER];
    const organizationId = Array.isArray(raw) ? raw[0] : raw;
    if (!organizationId?.trim()) {
      throw new BadRequestAppException(
        'X-Organization-Id header is required for this API',
      );
    }

    const org = await this.proxy.sendAuth<OrganizationView>(
      AUTH_PATTERNS.RESOLVE_TENANT,
      {
        userId: request.user.id,
        organizationId: organizationId.trim(),
      },
      { skipTenant: true },
    );

    if (!org || org.status !== 'active') {
      throw new ForbiddenAppException('Organization is not available');
    }

    request.organization = org;
    return true;
  }
}
