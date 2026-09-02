import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription } from 'web-push';
import { PresenceStatus, REDIS_CLIENT } from '@app/common';
import type Redis from 'ioredis';
import { PresenceService } from './presence.service';

type StoredSubscription = PushSubscription & { endpoint: string };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY', '');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY', '');
    this.enabled = Boolean(publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(
        this.config.get<string>('VAPID_SUBJECT', 'mailto:admin@relay.local'),
        publicKey,
        privateKey,
      );
      this.logger.log('Web Push (VAPID) enabled');
    } else {
      this.logger.warn(
        'VAPID keys not set — browser push for offline users is disabled',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPublicKey(): string | null {
    if (!this.enabled) return null;
    return this.config.get<string>('VAPID_PUBLIC_KEY') || null;
  }

  async subscribe(userId: string, subscription: PushSubscription): Promise<void> {
    const key = this.key(userId);
    const existing = await this.readAll(userId);
    const next = [
      ...existing.filter((item) => item.endpoint !== subscription.endpoint),
      subscription as StoredSubscription,
    ].slice(-5);
    await this.redis.set(key, JSON.stringify(next));
  }

  async unsubscribe(userId: string, endpoint?: string): Promise<void> {
    if (!endpoint) {
      await this.redis.del(this.key(userId));
      return;
    }
    const next = (await this.readAll(userId)).filter(
      (item) => item.endpoint !== endpoint,
    );
    if (next.length === 0) {
      await this.redis.del(this.key(userId));
      return;
    }
    await this.redis.set(this.key(userId), JSON.stringify(next));
  }

  async notifyOfflineRecipients(input: {
    recipientIds: string[];
    senderId: string;
    title: string;
    body: string;
    conversationId: string;
  }): Promise<void> {
    if (!this.enabled) return;

    await Promise.all(
      input.recipientIds
        .filter((id) => id !== input.senderId)
        .map(async (userId) => {
          const presence = await this.presence.getPresence(userId);
          if (presence.status !== PresenceStatus.OFFLINE) {
            return;
          }
          await this.sendToUser(userId, {
            title: input.title,
            body: input.body,
            conversationId: input.conversationId,
          });
        }),
    );
  }

  private async sendToUser(
    userId: string,
    payload: { title: string; body: string; conversationId: string },
  ): Promise<void> {
    const subs = await this.readAll(userId);
    if (subs.length === 0) return;

    const data = JSON.stringify(payload);
    const keep: StoredSubscription[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, data);
        keep.push(sub);
      } catch (error) {
        const status =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          continue;
        }
        keep.push(sub);
        this.logger.warn(
          `Push failed for ${userId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
    if (keep.length === 0) {
      await this.redis.del(this.key(userId));
    } else if (keep.length !== subs.length) {
      await this.redis.set(this.key(userId), JSON.stringify(keep));
    }
  }

  private async readAll(userId: string): Promise<StoredSubscription[]> {
    const raw = await this.redis.get(this.key(userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as StoredSubscription[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private key(userId: string): string {
    return `chat:push:sub:${userId}`;
  }
}
