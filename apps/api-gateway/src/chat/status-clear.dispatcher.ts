import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

const DISPATCH_INTERVAL_MS = 15_000;

@Injectable()
export class StatusClearDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusClearDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly presence: PresenceService,
    private readonly chatGateway: ChatGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, DISPATCH_INTERVAL_MS);
    setTimeout(() => void this.tick(), 4_000);
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
      const cleared = await this.presence.clearDueStatuses();
      for (const presence of cleared) {
        this.chatGateway.emitPresenceUpdate(presence);
      }
    } catch (error) {
      this.logger.warn(
        `Status clear dispatch failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
