import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

/** Retention purge is heavier than disappearing expiry — run every 5 minutes. */
const PURGE_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class RetentionPurgeDispatcher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RetentionPurgeDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly proxy: MicroserviceProxy) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, PURGE_INTERVAL_MS);
    setTimeout(() => void this.tick(), 20_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.proxy.sendChat<{
        purgedTotal: number;
        results: Array<{ organizationId: string; purgedCount: number }>;
      }>(
        CHAT_PATTERNS.RUN_RETENTION_PURGE,
        { trigger: 'scheduled' },
        { skipTenant: true },
      );
      if (result?.purgedTotal > 0) {
        this.logger.log(
          `Retention purge removed ${result.purgedTotal} message(s) across ${result.results.length} workspace(s)`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Retention purge failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
