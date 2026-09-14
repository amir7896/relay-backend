import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { OrganizationView } from '@app/contracts';
import { gatewayTenantAls } from './tenant-context';

@Injectable()
export class OrganizationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      organization?: OrganizationView;
    }>();
    const org = request.organization;
    if (!org) {
      return next.handle();
    }
    return new Observable((subscriber) => {
      gatewayTenantAls.run(org, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
