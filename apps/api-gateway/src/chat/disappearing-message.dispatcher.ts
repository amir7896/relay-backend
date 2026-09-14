import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { DeleteMessageResult } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from './chat.gateway';

const EXPIRE_INTERVAL_MS = 10_000;

@Injectable()
export class DisappearingMessageDispatcher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DisappearingMessageDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, EXPIRE_INTERVAL_MS);
    setTimeout(() => void this.tick(), 4_000);
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
      const expired = await this.proxy.sendChat<DeleteMessageResult[]>(
        CHAT_PATTERNS.EXPIRE_DUE_MESSAGES,
        {},
      );
      if (!Array.isArray(expired) || expired.length === 0) {
        return;
      }
      for (const result of expired) {
        this.chatGateway.broadcastMessageDeleted(
          result.message,
          result.recipientIds,
        );
        if (result.removedAttachmentUrl) {
          try {
            await this.storage.deleteByUrl(result.removedAttachmentUrl);
          } catch {
            // Best-effort cleanup
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Disappearing expiry failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
