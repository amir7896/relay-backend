import { Injectable, Logger } from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import { MicroserviceProxy } from '../proxy/microservice.proxy';
import { getGatewayTenant } from '../../organizations/tenant-context';

export type AuditLogInput = {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  /** Required when the request has no org tenant context (@SkipOrg). */
  organizationId?: string;
};

/**
 * Fire-and-forget workspace audit events into chat-service audit_events.
 * Failures are logged but never block the primary request.
 */
@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);

  constructor(private readonly proxy: MicroserviceProxy) {}

  log(input: AuditLogInput): void {
    const organizationId =
      input.organizationId?.trim() || getGatewayTenant()?.id;
    if (!organizationId) {
      this.logger.warn(
        `Skipped audit ${input.action}: no organizationId`,
      );
      return;
    }

    void this.proxy
      .sendChat(
        CHAT_PATTERNS.LOG_AUDIT,
        {
          actorId: input.actorId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          meta: input.meta ?? {},
          organizationId,
        },
        { skipTenant: true },
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit ${input.action} failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
  }
}
