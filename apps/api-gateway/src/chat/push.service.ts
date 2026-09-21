import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription } from 'web-push';
import { PresenceStatus, REDIS_CLIENT } from '@app/common';
import type Redis from 'ioredis';
import { PresenceService } from './presence.service';
import { NotificationPrefsService } from './notification-prefs.service';

type StoredSubscription = PushSubscription & { endpoint: string };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
    private readonly prefs: NotificationPrefsService,
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
    /** User ids @mentioned in this message — still notify when muted. */
    mentionUserIds?: string[];
    /** User ids who muted this conversation. */
    mutedRecipientIds?: string[];
  }): Promise<void> {
    if (!this.enabled) return;

    const mentioned = new Set(input.mentionUserIds ?? []);
    const muted = new Set(input.mutedRecipientIds ?? []);

    await Promise.all(
      input.recipientIds
        .filter((id) => id !== input.senderId)
        .map(async (userId) => {
          const isMentioned = mentioned.has(userId);
          const prefs = await this.prefs.get(userId);
          const myStatus = prefs.respectStatus
            ? await this.presence.getManualMode(userId)
            : null;
          const decision = this.prefs.shouldNotifyMessage(prefs, {
            conversationId: input.conversationId,
            mentionsMe: isMentioned,
            muted: muted.has(userId),
            body: input.body,
            myStatus,
          });
          if (!decision.notify) {
            return;
          }

          const presence = await this.presence.getPresence(userId);
          if (presence.status !== PresenceStatus.OFFLINE) {
            return;
          }
          const highlightLabel = isMentioned
            ? 'mentioned you'
            : decision.matchedKeyword
              ? 'keyword match'
              : null;
          await this.sendToUser(userId, {
            title: highlightLabel
              ? `${input.title} · ${highlightLabel}`
              : input.title,
            body: isMentioned
              ? `Mention: ${input.body}`.slice(0, 120)
              : decision.matchedKeyword
                ? `Keyword: ${input.body}`.slice(0, 120)
                : input.body,
            conversationId: input.conversationId,
          });
        }),
    );
  }

  /**
   * Incoming call push — sent even if the user still has a socket (tab may be
   * backgrounded / muted by autoplay policy).
   */
  async notifyCallInvite(input: {
    recipientIds: string[];
    senderId: string;
    title: string;
    body: string;
    conversationId: string;
    callId: string;
    media: 'audio' | 'video';
    kind: 'private' | 'group';
  }): Promise<void> {
    if (!this.enabled) return;

    await Promise.all(
      input.recipientIds
        .filter((id) => id !== input.senderId)
        .map(async (userId) => {
          const prefs = await this.prefs.get(userId);
          if (prefs.mode === 'none') {
            return;
          }
          if (prefs.respectStatus) {
            const mode = await this.presence.getManualMode(userId);
            if (mode === PresenceStatus.DND) {
              return;
            }
          }
          await this.sendToUser(userId, {
            title: input.title,
            body: input.body,
            conversationId: input.conversationId,
            type: 'call',
            callId: input.callId,
            media: input.media,
            kind: input.kind,
          });
        }),
    );
  }

  /**
   * Task assignment push — respects DND / mode none, but still notifies online
   * users (tab may be backgrounded).
   */
  async notifyAssignment(input: {
    recipientId: string;
    senderId: string;
    title: string;
    body: string;
    conversationId: string;
    notificationId: string;
  }): Promise<void> {
    if (!this.enabled) return;
    if (!input.recipientId || input.recipientId === input.senderId) return;

    const prefs = await this.prefs.get(input.recipientId);
    if (prefs.mode === 'none') return;
    if (prefs.respectStatus) {
      const mode = await this.presence.getManualMode(input.recipientId);
      if (mode === PresenceStatus.DND) return;
    }

    await this.sendToUser(input.recipientId, {
      title: input.title,
      body: input.body,
      conversationId: input.conversationId,
      type: 'list_assignment',
      notificationId: input.notificationId,
    });
  }

  private async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      conversationId: string;
      type?: string;
      callId?: string;
      media?: string;
      kind?: string;
      notificationId?: string;
    },
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
