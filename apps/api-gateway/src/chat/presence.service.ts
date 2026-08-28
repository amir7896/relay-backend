import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PresenceStatus, REDIS_CLIENT } from '@app/common';
import type { ConversationView, PresenceView } from '@app/contracts';

const ONLINE_TTL_SECONDS = 45;
const SOCKETS_TTL_SECONDS = 86_400;

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async connect(
    userId: string,
    socketId: string,
  ): Promise<{ becameOnline: boolean }> {
    const wasOnline = (await this.redis.exists(this.onlineKey(userId))) === 1;
    await this.redis.sadd(this.socketsKey(userId), socketId);
    await this.redis.expire(this.socketsKey(userId), SOCKETS_TTL_SECONDS);
    await this.redis.set(this.onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS);
    await this.redis.del(this.lastSeenKey(userId));
    return { becameOnline: !wasOnline };
  }

  async disconnect(
    userId: string,
    socketId: string,
  ): Promise<{
    status: PresenceStatus;
    lastSeenAt: string | null;
  }> {
    await this.redis.srem(this.socketsKey(userId), socketId);
    const remaining = await this.redis.scard(this.socketsKey(userId));
    if (remaining > 0) {
      await this.redis.expire(this.onlineKey(userId), ONLINE_TTL_SECONDS);
      return { status: PresenceStatus.ONLINE, lastSeenAt: null };
    }

    await this.redis.del(this.onlineKey(userId));
    const lastSeenAt = new Date().toISOString();
    await this.redis.set(this.lastSeenKey(userId), lastSeenAt);
    return { status: PresenceStatus.OFFLINE, lastSeenAt };
  }

  async heartbeat(userId: string): Promise<void> {
    const sockets = await this.redis.scard(this.socketsKey(userId));
    if (sockets > 0) {
      await this.redis.expire(this.onlineKey(userId), ONLINE_TTL_SECONDS);
    }
  }

  async getPresence(userId: string): Promise<PresenceView> {
    const map = await this.getMany([userId]);
    return (
      map.get(userId) ?? {
        userId,
        status: PresenceStatus.OFFLINE,
        lastSeenAt: null,
      }
    );
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
    const presence = await this.getMany(userIds);
    for (const conversation of conversations) {
      for (const member of conversation.members) {
        const live = presence.get(member.userId);
        member.status = live?.status ?? PresenceStatus.OFFLINE;
        member.lastSeenAt = live?.lastSeenAt ?? null;
      }
    }
  }

  private async getMany(
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
    }
    const replies = await pipeline.exec();

    userIds.forEach((userId, index) => {
      const onlineReply = replies?.[index * 2];
      const lastSeenReply = replies?.[index * 2 + 1];
      const isOnline = Number(onlineReply?.[1] ?? 0) === 1;
      const lastSeenAt =
        typeof lastSeenReply?.[1] === 'string' ? lastSeenReply[1] : null;
      result.set(userId, {
        userId,
        status: isOnline ? PresenceStatus.ONLINE : PresenceStatus.OFFLINE,
        lastSeenAt: isOnline ? null : lastSeenAt,
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
