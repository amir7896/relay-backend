import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrganizationView } from '@app/contracts';

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationView | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      organization?: OrganizationView;
    }>();
    return request.organization;
  },
);
