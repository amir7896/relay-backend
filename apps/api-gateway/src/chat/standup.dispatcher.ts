import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { ChatGateway } from './chat.gateway';

const DISPATCH_INTERVAL_MS = 30_000;

@Injectable()
export class StandupDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StandupDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, DISPATCH_INTERVAL_MS);
    setTimeout(() => void this.tick(), 5_000);
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
      const messages = await this.proxy.sendChat<
        Array<Record<string, unknown> & { conversationId: string; recipientIds?: string[] }>
      >(CHAT_PATTERNS.DISPATCH_DUE_STANDUPS, {}, { skipTenant: true });
      if (!Array.isArray(messages) || messages.length === 0) return;
      for (const message of messages) {
        const { recipientIds, ...view } = message;
        this.chatGateway.broadcastMessage(view as any, recipientIds ?? []);
      }
    } catch (error) {
      this.logger.warn(
        `Standup dispatch failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
