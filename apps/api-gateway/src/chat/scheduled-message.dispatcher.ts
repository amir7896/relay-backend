import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { SendMessageResult } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { ChatGateway } from './chat.gateway';
import { ConversationCacheService } from './conversation-cache.service';
import { PushService } from './push.service';

const DISPATCH_INTERVAL_MS = 15_000;

@Injectable()
export class ScheduledMessageDispatcher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScheduledMessageDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
    private readonly conversationCache: ConversationCacheService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, DISPATCH_INTERVAL_MS);
    // First pass shortly after boot so demos don't wait a full interval
    setTimeout(() => void this.tick(), 3_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const delivered = await this.proxy.sendChat<SendMessageResult[]>(
        CHAT_PATTERNS.DISPATCH_DUE_SCHEDULED,
        {},
      );
      if (!Array.isArray(delivered) || delivered.length === 0) {
        return;
      }
      for (const result of delivered) {
        const { recipientIds, ...data } = result;
        await this.conversationCache.setMemberIds(
          data.conversationId,
          recipientIds,
        );
        this.chatGateway.broadcastMessage(data, recipientIds);
        void this.push.notifyOfflineRecipients({
          recipientIds,
          senderId: data.senderId,
          title: 'New Relay message',
          body: (data.body || 'Attachment').slice(0, 120),
          conversationId: data.conversationId,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Scheduled dispatch failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
