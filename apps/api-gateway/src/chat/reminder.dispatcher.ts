import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { ReminderDispatchResult } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { ChatGateway } from './chat.gateway';
import { PushService } from './push.service';

const DISPATCH_INTERVAL_MS = 15_000;

@Injectable()
export class ReminderDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly chatGateway: ChatGateway,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, DISPATCH_INTERVAL_MS);
    setTimeout(() => void this.tick(), 3_500);
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
      const due = await this.proxy.sendChat<ReminderDispatchResult[]>(
        CHAT_PATTERNS.DISPATCH_DUE_REMINDERS,
        {},
        { skipTenant: true },
      );
      if (Array.isArray(due) && due.length > 0) {
        for (const reminder of due) {
          this.chatGateway.emitReminder(reminder.userId, {
            id: reminder.id,
            conversationId: reminder.conversationId,
            messageId: reminder.messageId,
            bodySnippet: reminder.bodySnippet,
            remindAt: reminder.remindAt,
          });
          void this.push.notifyOfflineRecipients({
            recipientIds: [reminder.userId],
            // System-style: exclude filter skips sender — use empty sentinel
            senderId: '',
            title: 'Reminder',
            body: reminder.bodySnippet,
            conversationId: reminder.conversationId,
            mentionUserIds: [],
            mutedRecipientIds: [],
          });
        }
      }

      const listDue = await this.proxy.sendChat<{
        notifications?: Array<{
          id: string;
          userId: string;
          actorId: string;
          title: string;
          body: string;
          conversationId: string | null;
          type?: string;
          listId?: string | null;
          listItemId?: string | null;
          meta?: Record<string, unknown>;
          readAt?: string | null;
          createdAt?: string;
          unread?: boolean;
          organizationId?: string;
        }>;
      }>(CHAT_PATTERNS.DISPATCH_DUE_LIST_ITEMS, {}, { skipTenant: true });
      for (const notification of listDue?.notifications ?? []) {
        if (!notification?.userId) continue;
        this.chatGateway.emitUserNotification(
          notification.userId,
          notification,
        );
        if (notification.conversationId) {
          void this.push.notifyAssignment({
            recipientId: notification.userId,
            senderId: notification.actorId,
            title: notification.title,
            body: notification.body,
            conversationId: notification.conversationId,
            notificationId: notification.id,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `Reminder dispatch failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
