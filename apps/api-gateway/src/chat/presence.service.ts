import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PresenceStatus, REDIS_CLIENT } from '@app/common';
import type { ConversationView, PresenceView } from '@app/contracts';

const ONLINE_TTL_SECONDS = 45;
const SOCKETS_TTL_SECONDS = 86_400;
const MODE_TTL_SECONDS = 86_400 * 7;

const MANUAL_STATUSES = new Set<PresenceStatus>([
  PresenceStatus.AWAY,
  PresenceStatus.BUSY,
  PresenceStatus.DND,
]);

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async connect(
    userId: string,
    socketId: string,
  ): Promise<{ becameOnline: boolean; presence: PresenceView }> {
    const wasOnline = (await this.redis.exists(this.onlineKey(userId))) === 1;
    await this.redis.sadd(this.socketsKey(userId), socketId);
    await this.redis.expire(this.socketsKey(userId), SOCKETS_TTL_SECONDS);
    await this.redis.set(this.onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS);
    await this.redis.del(this.lastSeenKey(userId));
    const presence = await this.getPresence(userId);
    return { becameOnline: !wasOnline, presence };
  }

  async disconnect(
    userId: string,
    socketId: string,
  ): Promise<PresenceView> {
    await this.redis.srem(this.socketsKey(userId), socketId);
    const remaining = await this.redis.scard(this.socketsKey(userId));
    if (remaining > 0) {
      await this.redis.expire(this.onlineKey(userId), ONLINE_TTL_SECONDS);
      return this.getPresence(userId);
    }

    await this.redis.del(this.onlineKey(userId));
    const lastSeenAt = new Date().toISOString();
    await this.redis.set(this.lastSeenKey(userId), lastSeenAt);
    const customStatus = await this.redis.get(this.customKey(userId));
    return {
      userId,
      status: PresenceStatus.OFFLINE,
      lastSeenAt,
      customStatus: customStatus || null,
    };
  }

  async heartbeat(userId: string): Promise<void> {
    const sockets = await this.redis.scard(this.socketsKey(userId));
    if (sockets > 0) {
      await this.redis.expire(this.onlineKey(userId), ONLINE_TTL_SECONDS);
    }
  }

  async setStatus(
    userId: string,
    status: PresenceStatus,
    customStatus?: string | null,
  ): Promise<PresenceView> {
    if (status === PresenceStatus.OFFLINE) {
      return this.getPresence(userId);
    }

    if (status === PresenceStatus.ONLINE) {
      await this.redis.del(this.modeKey(userId));
    } else if (MANUAL_STATUSES.has(status)) {
      await this.redis.set(
        this.modeKey(userId),
        status,
        'EX',
        MODE_TTL_SECONDS,
      );
    }

    if (customStatus !== undefined) {
      const trimmed = customStatus?.trim() || '';
      if (!trimmed) {
        await this.redis.del(this.customKey(userId));
      } else {
        await this.redis.set(
          this.customKey(userId),
          trimmed.slice(0, 120),
          'EX',
          MODE_TTL_SECONDS,
        );
      }
    }

    return this.getPresence(userId);
  }

  async getPresence(userId: string): Promise<PresenceView> {
    const map = await this.getPresenceMap([userId]);
    return (
      map.get(userId) ?? {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeenAt: null,
        customStatus: null,
      }
    );
  }

  /** Manual Away/Busy/DND mode even while sockets are gone (for push suppression). */
  async getManualMode(userId: string): Promise<PresenceStatus | null> {
    const mode = await this.redis.get(this.modeKey(userId));
    if (mode && MANUAL_STATUSES.has(mode as PresenceStatus)) {
      return mode as PresenceStatus;
    }
    return null;
  }

  async attachToConversations(
    conversations: ConversationView[],
  ): Promise<void> {
    const userIds = [
      ...new Set(
        conversations.flatMap((conversation) =>
          conversation.members.map((member) => member.userId),
        ),
      ),
    ];
    const presence = await this.getPresenceMap(userIds);
    for (const conversation of conversations) {
      for (const member of conversation.members) {
        const live = presence.get(member.userId);
        member.status = live?.status ?? PresenceStatus.OFFLINE;
        member.lastSeenAt = live?.lastSeenAt ?? null;
        member.customStatus = live?.customStatus ?? null;
      }
    }
  }

  async getPresenceMap(
    userIds: string[],
  ): Promise<Map<string, PresenceView>> {
    const result = new Map<string, PresenceView>();
    if (userIds.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const userId of userIds) {
      pipeline.exists(this.onlineKey(userId));
      pipeline.get(this.lastSeenKey(userId));
      pipeline.get(this.modeKey(userId));
      pipeline.get(this.customKey(userId));
    }
    const replies = await pipeline.exec();

    userIds.forEach((userId, index) => {
      const base = index * 4;
      const onlineReply = replies?.[base];
      const lastSeenReply = replies?.[base + 1];
      const modeReply = replies?.[base + 2];
      const customReply = replies?.[base + 3];
      const isOnline = Number(onlineReply?.[1] ?? 0) === 1;
      const lastSeenAt =
        typeof lastSeenReply?.[1] === 'string' ? lastSeenReply[1] : null;
      const mode =
        typeof modeReply?.[1] === 'string' ? modeReply[1] : null;
      const customStatus =
        typeof customReply?.[1] === 'string' ? customReply[1] : null;

      let status = PresenceStatus.OFFLINE;
      if (isOnline) {
        if (mode && MANUAL_STATUSES.has(mode as PresenceStatus)) {
          status = mode as PresenceStatus;
        } else {
          status = PresenceStatus.ONLINE;
        }
      }

      result.set(userId, {
        userId,
        status,
        lastSeenAt: isOnline ? null : lastSeenAt,
        customStatus: customStatus || null,
      });
    });

    return result;
  }

  private onlineKey(userId: string): string {
    return `chat:presence:online:${userId}`;
  }

  private socketsKey(userId: string): string {
    return `chat:presence:sockets:${userId}`;
  }

  private lastSeenKey(userId: string): string {
    return `chat:presence:lastSeen:${userId}`;
  }

  private modeKey(userId: string): string {
    return `chat:presence:mode:${userId}`;
  }

  private customKey(userId: string): string {
    return `chat:presence:custom:${userId}`;
  }

  async countOnlineUsers(): Promise<number> {
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'chat:presence:online:*',
        'COUNT',
        100,
      );
      cursor = next;
      total += keys.length;
    } while (cursor !== '0');
    return total;
  }
}
