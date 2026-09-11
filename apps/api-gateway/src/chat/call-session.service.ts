import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@app/common';

export type CallStatus = 'ringing' | 'active' | 'ended';
export type CallKind = 'private' | 'group';
export type CallMedia = 'audio' | 'video';

export type VoiceCallSession = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  media: CallMedia;
  hostId: string;
  /** Everyone invited (conversation members at start / mid-call adds). */
  memberIds: string[];
  /** Currently connected in the media call. */
  joinedIds: string[];
  /** Declined the ring (can still rejoin a live group call). */
  declinedIds: string[];
  /** Left after joining (can rejoin a live group call; no auto-ring). */
  leftIds: string[];
  /** Coordinated hold (primarily 1:1; works for group too). */
  onHold: boolean;
  heldBy: string | null;
  /** Host mute-all: joined peers should mute local mic. */
  forceMuted: boolean;
  /** Optional UI hint for who is screen-sharing. */
  screenSharerId: string | null;
  status: CallStatus;
  createdAt: string;
  /** When the call first became multi-party active (for duration). */
  connectedAt: string | null;
};

const RINGING_TTL_SECONDS = 50;
const ACTIVE_TTL_SECONDS = 60 * 60;
const SESSION_PREFIX = 'chat:call:session:';
const USER_PREFIX = 'chat:call:user:';
const CONVO_PREFIX = 'chat:call:conversation:';

export type CallLobbyPayload = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  media: CallMedia;
  hostId: string;
  memberIds: string[];
  joinedIds: string[];
  declinedIds: string[];
  leftIds: string[];
  ringingIds: string[];
  onHold: boolean;
  heldBy: string | null;
  forceMuted: boolean;
  screenSharerId: string | null;
  active: boolean;
};

/** Rich roster for in-call participant list (WhatsApp-style). */
export type CallRosterPayload = {
  callId: string;
  conversationId: string;
  hostId: string;
  joinedIds: string[];
  ringingIds: string[];
  declinedIds: string[];
  leftIds: string[];
  memberIds: string[];
  onHold: boolean;
  heldBy: string | null;
  forceMuted: boolean;
  screenSharerId: string | null;
};

@Injectable()
export class CallSessionService {
  private readonly logger = new Logger(CallSessionService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async createCall(input: {
    conversationId: string;
    kind: CallKind;
    hostId: string;
    memberIds: string[];
    media?: CallMedia;
  }): Promise<VoiceCallSession | { error: string }> {
    const busyHost = await this.getActiveCallIdForUser(input.hostId);
    if (busyHost) {
      const existing = await this.get(busyHost);
      // Stale busy lock (session gone / index broken) — clear and allow a new call
      if (!existing || existing.status === 'ended') {
        await this.clearUserBusy(input.hostId, busyHost);
      } else if (
        existing.joinedIds.includes(input.hostId) ||
        existing.hostId === input.hostId
      ) {
        return { error: 'You are already in a call' };
      } else {
        // Marked ringing on another call but never joined — release lock
        await this.clearUserBusy(input.hostId, busyHost);
      }
    }

    // One live call per conversation — replace stale lobby if host restarts
    const existingConvo = await this.getByConversation(input.conversationId);
    if (existingConvo) {
      if (
        existingConvo.hostId === input.hostId ||
        existingConvo.joinedIds.length <= 1
      ) {
        await this.end(existingConvo.callId);
      } else {
        return { error: 'A call is already in progress in this group' };
      }
    }

    const memberIds = [...new Set(input.memberIds)];
    if (!memberIds.includes(input.hostId)) {
      memberIds.push(input.hostId);
    }
    if (memberIds.length < 2) {
      return { error: 'Not enough participants for a call' };
    }

    // Private: both parties must be free. Group: only host must be free to start;
    // busy members simply won't join.
    if (input.kind === 'private') {
      const otherId = memberIds.find((id) => id !== input.hostId);
      if (otherId) {
        const busyOther = await this.getActiveCallIdForUser(otherId);
        if (busyOther) {
          return { error: 'User is busy on another call' };
        }
      }
    }

    const session: VoiceCallSession = {
      callId: randomUUID(),
      conversationId: input.conversationId,
      kind: input.kind,
      media: input.media === 'video' ? 'video' : 'audio',
      hostId: input.hostId,
      memberIds,
      joinedIds: [input.hostId],
      declinedIds: [],
      leftIds: [],
      onHold: false,
      heldBy: null,
      forceMuted: false,
      screenSharerId: null,
      status: 'ringing',
      createdAt: new Date().toISOString(),
      connectedAt: null,
    };

    await this.persist(session, RINGING_TTL_SECONDS);
    await this.redis.set(
      this.convoKey(session.conversationId),
      session.callId,
      'EX',
      RINGING_TTL_SECONDS,
    );
    return session;
  }

  async getByConversation(
    conversationId: string,
  ): Promise<VoiceCallSession | null> {
    const callId = await this.redis.get(this.convoKey(conversationId));
    if (callId) {
      const session = await this.get(callId);
      if (
        session &&
        session.conversationId === conversationId &&
        session.status !== 'ended'
      ) {
        return session;
      }
      await this.redis.del(this.convoKey(conversationId));
    }
    return this.findSessionByConversation(conversationId);
  }

  /** Recovery when conversation→call index was lost (Join / active-call otherwise 404). */
  private async findSessionByConversation(
    conversationId: string,
  ): Promise<VoiceCallSession | null> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${SESSION_PREFIX}*`,
        'COUNT',
        64,
      );
      cursor = next;
      for (const key of keys) {
        const raw = await this.redis.get(key);
        if (!raw) {
          continue;
        }
        try {
          const session = JSON.parse(raw) as VoiceCallSession;
          if (
            session.conversationId === conversationId &&
            session.status !== 'ended' &&
            session.joinedIds?.length
          ) {
            const ttl = await this.redis.ttl(key);
            const ttlSeconds = ttl > 0 ? ttl : ACTIVE_TTL_SECONDS;
            await this.redis.set(
              this.convoKey(conversationId),
              session.callId,
              'EX',
              ttlSeconds,
            );
            if (!session.leftIds) {
              session.leftIds = [];
            }
            if (!session.declinedIds) {
              session.declinedIds = [];
            }
            return session;
          }
        } catch {
          // skip corrupt
        }
      }
    } while (cursor !== '0');
    return null;
  }

  toLobby(session: VoiceCallSession, active = true): CallLobbyPayload {
    const normalized = this.normalize(session);
    return {
      callId: normalized.callId,
      conversationId: normalized.conversationId,
      kind: normalized.kind,
      media: normalized.media ?? 'audio',
      hostId: normalized.hostId,
      memberIds: normalized.memberIds,
      joinedIds: normalized.joinedIds,
      declinedIds: normalized.declinedIds,
      leftIds: normalized.leftIds,
      ringingIds: this.ringingIds(normalized),
      onHold: normalized.onHold,
      heldBy: normalized.heldBy,
      forceMuted: normalized.forceMuted,
      screenSharerId: normalized.screenSharerId,
      active,
    };
  }

  toRoster(session: VoiceCallSession): CallRosterPayload {
    const normalized = this.normalize(session);
    return {
      callId: normalized.callId,
      conversationId: normalized.conversationId,
      hostId: normalized.hostId,
      joinedIds: normalized.joinedIds,
      ringingIds: this.ringingIds(normalized),
      declinedIds: normalized.declinedIds,
      leftIds: normalized.leftIds,
      memberIds: normalized.memberIds,
      onHold: normalized.onHold,
      heldBy: normalized.heldBy,
      forceMuted: normalized.forceMuted,
      screenSharerId: normalized.screenSharerId,
    };
  }

  /** Group member not currently in the call, while others are still connected. */
  canRejoin(session: VoiceCallSession, userId: string): boolean {
    return (
      session.kind === 'group' &&
      session.status !== 'ended' &&
      this.isMember(session, userId) &&
      !this.isJoined(session, userId) &&
      session.joinedIds.length > 0
    );
  }

  async get(callId: string): Promise<VoiceCallSession | null> {
    const raw = await this.redis.get(this.sessionKey(callId));
    if (!raw) {
      return null;
    }
    try {
      const session = this.normalize(JSON.parse(raw) as VoiceCallSession);
      // Repair missing conversation→call index (breaks GET active-call / Join banner)
      if (session.conversationId && session.status !== 'ended') {
        const indexed = await this.redis.get(this.convoKey(session.conversationId));
        if (indexed !== callId) {
          const ttl = await this.redis.ttl(this.sessionKey(callId));
          const ttlSeconds = ttl > 0 ? ttl : ACTIVE_TTL_SECONDS;
          await this.redis.set(
            this.convoKey(session.conversationId),
            callId,
            'EX',
            ttlSeconds,
          );
        }
      }
      return session;
    } catch {
      this.logger.warn(`Corrupt call session payload for ${callId}`);
      return null;
    }
  }

  async getActiveCallIdForUser(userId: string): Promise<string | null> {
    return this.redis.get(this.userKey(userId));
  }

  /** Drop busy mapping for a ringing peer without ending/leaving the call. */
  async clearUserBusy(userId: string, callId?: string): Promise<void> {
    const current = await this.getActiveCallIdForUser(userId);
    if (!current) {
      return;
    }
    if (callId && current !== callId) {
      return;
    }
    await this.redis.del(this.userKey(userId));
  }

  isMember(session: VoiceCallSession, userId: string): boolean {
    return session.memberIds.includes(userId);
  }

  isJoined(session: VoiceCallSession, userId: string): boolean {
    return session.joinedIds.includes(userId);
  }

  async accept(
    callId: string,
    userId: string,
  ): Promise<VoiceCallSession | { error: string }> {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (!this.isMember(session, userId)) {
      return { error: 'You are not invited to this call' };
    }
    if (session.joinedIds.includes(userId)) {
      return session;
    }
    if (session.kind === 'private' && userId === session.hostId) {
      return { error: 'Host is already in the call' };
    }

    const busy = await this.getActiveCallIdForUser(userId);
    if (busy && busy !== callId) {
      return { error: 'You are already in another call' };
    }

    session.joinedIds = [...new Set([...session.joinedIds, userId])];
    session.declinedIds = session.declinedIds.filter((id) => id !== userId);
    session.leftIds = session.leftIds.filter((id) => id !== userId);
    session.status = 'active';
    if (!session.connectedAt && session.joinedIds.length >= 2) {
      session.connectedAt = new Date().toISOString();
    }
    await this.persist(session, ACTIVE_TTL_SECONDS);
    await this.redis.set(
      this.convoKey(session.conversationId),
      session.callId,
      'EX',
      ACTIVE_TTL_SECONDS,
    );
    return session;
  }

  async decline(
    callId: string,
    userId: string,
  ): Promise<
    | { session: VoiceCallSession; ended: boolean }
    | { error: string }
  > {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (!this.isMember(session, userId) || session.joinedIds.includes(userId)) {
      return { error: 'Cannot decline this call' };
    }

    session.declinedIds = [...new Set([...session.declinedIds, userId])];

    if (session.kind === 'private') {
      await this.end(callId);
      return { session: { ...session, status: 'ended' }, ended: true };
    }

    const pending = session.memberIds.filter(
      (id) =>
        !session.joinedIds.includes(id) && !session.declinedIds.includes(id),
    );
    // Everyone else declined and only host remains → keep ringing until timeout/hangup
    await this.persist(
      session,
      session.status === 'active' ? ACTIVE_TTL_SECONDS : RINGING_TTL_SECONDS,
    );
    return { session, ended: false, pendingCount: pending.length } as {
      session: VoiceCallSession;
      ended: boolean;
    };
  }

  async leave(
    callId: string,
    userId: string,
  ): Promise<
    | { session: VoiceCallSession; ended: boolean; remainingIds: string[] }
    | { error: string }
  > {
    const session = await this.get(callId);
    if (!session) {
      return { error: 'Call not found' };
    }
    if (!this.isMember(session, userId)) {
      return { error: 'You are not part of this call' };
    }

    session.joinedIds = session.joinedIds.filter((id) => id !== userId);
    session.leftIds = [...new Set([...(session.leftIds ?? []), userId])];
    await this.redis.del(this.userKey(userId));

    if (session.joinedIds.length === 0) {
      await this.end(callId);
      return { session: { ...session, status: 'ended' }, ended: true, remainingIds: [] };
    }

    // Private: either party leaving ends the call
    if (session.kind === 'private') {
      await this.end(callId);
      return {
        session: { ...session, status: 'ended' },
        ended: true,
        remainingIds: [],
      };
    }

    await this.persist(session, ACTIVE_TTL_SECONDS);
    await this.redis.set(
      this.convoKey(session.conversationId),
      session.callId,
      'EX',
      ACTIVE_TTL_SECONDS,
    );
    return {
      session,
      ended: false,
      remainingIds: session.joinedIds,
    };
  }

  /**
   * When a user is removed from / leaves a group, revoke them from any live
   * call on that conversation so Redis membership cannot outlive DB membership.
   */
  async revokeUserFromConversation(
    conversationId: string,
    userId: string,
  ): Promise<
    | {
        callId: string;
        session: VoiceCallSession;
        ended: boolean;
        remainingIds: string[];
      }
    | null
  > {
    const session = await this.getByConversation(conversationId);
    if (!session || session.status === 'ended') {
      return null;
    }
    if (!this.isMember(session, userId) && !this.isJoined(session, userId)) {
      return null;
    }

    session.memberIds = session.memberIds.filter((id) => id !== userId);
    session.joinedIds = session.joinedIds.filter((id) => id !== userId);
    session.declinedIds = session.declinedIds.filter((id) => id !== userId);
    session.leftIds = [...new Set([...(session.leftIds ?? []), userId])];
    if (session.screenSharerId === userId) {
      session.screenSharerId = null;
    }
    if (session.heldBy === userId) {
      session.onHold = false;
      session.heldBy = null;
    }
    await this.redis.del(this.userKey(userId));

    if (
      session.joinedIds.length === 0 ||
      session.memberIds.length === 0 ||
      session.kind === 'private'
    ) {
      await this.end(session.callId);
      return {
        callId: session.callId,
        session: { ...session, status: 'ended' },
        ended: true,
        remainingIds: [],
      };
    }

    if (session.hostId === userId) {
      session.hostId = session.joinedIds[0] ?? session.memberIds[0];
    }

    await this.persist(session, ACTIVE_TTL_SECONDS);
    await this.redis.set(
      this.convoKey(session.conversationId),
      session.callId,
      'EX',
      ACTIVE_TTL_SECONDS,
    );
    return {
      callId: session.callId,
      session,
      ended: false,
      remainingIds: session.joinedIds,
    };
  }

  async end(callId: string): Promise<VoiceCallSession | null> {
    const session = await this.get(callId);
    if (!session) {
      return null;
    }
    session.status = 'ended';
    const pipeline = this.redis.pipeline();
    pipeline.del(this.sessionKey(callId));
    pipeline.del(this.convoKey(session.conversationId));
    for (const userId of session.memberIds) {
      pipeline.del(this.userKey(userId));
    }
    await pipeline.exec();
    return session;
  }

  /** Users still ringing (invited, not joined, not declined/left). */
  ringingIds(session: VoiceCallSession): string[] {
    return session.memberIds.filter(
      (id) =>
        !session.joinedIds.includes(id) &&
        !session.declinedIds.includes(id) &&
        !(session.leftIds ?? []).includes(id),
    );
  }

  /**
   * Mid-call invite: expand members and re-ring left/declined peers.
   * Returns the userIds that should receive call:incoming.
   */
  async inviteMore(
    callId: string,
    actorId: string,
    userIds: string[],
    allowedMemberIds: string[],
  ): Promise<
    | { session: VoiceCallSession; invitedIds: string[] }
    | { error: string }
  > {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (session.kind !== 'group') {
      return { error: 'Can only add people to group calls' };
    }
    if (!this.isJoined(session, actorId)) {
      return { error: 'Join the call before inviting others' };
    }

    const allowed = new Set(allowedMemberIds);
    const requested = [...new Set(userIds)].filter(
      (id) => allowed.has(id) && id !== actorId,
    );
    if (requested.length === 0) {
      return { error: 'No valid members to invite' };
    }

    const MAX_GROUP_CALL = 8;
    const invitedIds: string[] = [];

    for (const userId of requested) {
      if (session.joinedIds.includes(userId)) {
        continue;
      }
      const busy = await this.getActiveCallIdForUser(userId);
      if (busy && busy !== callId) {
        continue;
      }

      if (!session.memberIds.includes(userId)) {
        if (session.memberIds.length >= MAX_GROUP_CALL) {
          continue;
        }
        session.memberIds = [...session.memberIds, userId];
      }

      session.declinedIds = session.declinedIds.filter((id) => id !== userId);
      session.leftIds = session.leftIds.filter((id) => id !== userId);
      invitedIds.push(userId);
    }

    if (invitedIds.length === 0) {
      return { error: 'Those members cannot be invited right now' };
    }

    await this.persist(
      session,
      session.status === 'active' ? ACTIVE_TTL_SECONDS : RINGING_TTL_SECONDS,
    );
    return { session, invitedIds };
  }

  async setHold(
    callId: string,
    actorId: string,
    onHold: boolean,
  ): Promise<VoiceCallSession | { error: string }> {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (!this.isJoined(session, actorId)) {
      return { error: 'You are not in this call' };
    }
    if (onHold) {
      session.onHold = true;
      session.heldBy = actorId;
    } else {
      // Only the holder (or host) can resume
      if (
        session.heldBy &&
        session.heldBy !== actorId &&
        session.hostId !== actorId
      ) {
        return { error: 'Only the person who put the call on hold can resume' };
      }
      session.onHold = false;
      session.heldBy = null;
    }
    await this.persist(session, ACTIVE_TTL_SECONDS);
    return session;
  }

  async setForceMute(
    callId: string,
    actorId: string,
    muted: boolean,
  ): Promise<VoiceCallSession | { error: string }> {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (session.hostId !== actorId) {
      return { error: 'Only the call host can mute everyone' };
    }
    if (!this.isJoined(session, actorId)) {
      return { error: 'You are not in this call' };
    }
    session.forceMuted = muted;
    await this.persist(session, ACTIVE_TTL_SECONDS);
    return session;
  }

  async setScreenShare(
    callId: string,
    actorId: string,
    active: boolean,
  ): Promise<VoiceCallSession | { error: string }> {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return { error: 'Call is no longer available' };
    }
    if (!this.isJoined(session, actorId)) {
      return { error: 'You are not in this call' };
    }
    if (active) {
      session.screenSharerId = actorId;
    } else if (session.screenSharerId === actorId || session.hostId === actorId) {
      session.screenSharerId = null;
    } else {
      return { error: 'You are not sharing the screen' };
    }
    await this.persist(session, ACTIVE_TTL_SECONDS);
    return session;
  }

  /** Soft-timeout unanswered mid-call invites without ending the call. */
  async markUnansweredAsLeft(
    callId: string,
    userIds: string[],
  ): Promise<VoiceCallSession | null> {
    const session = await this.get(callId);
    if (!session || session.status === 'ended') {
      return null;
    }
    let changed = false;
    for (const userId of userIds) {
      if (
        session.joinedIds.includes(userId) ||
        session.declinedIds.includes(userId)
      ) {
        continue;
      }
      if (!session.leftIds.includes(userId)) {
        session.leftIds = [...session.leftIds, userId];
        changed = true;
      }
      await this.clearUserBusy(userId, callId);
    }
    if (!changed) {
      return session;
    }
    await this.persist(
      session,
      session.status === 'active' ? ACTIVE_TTL_SECONDS : RINGING_TTL_SECONDS,
    );
    return session;
  }

  private normalize(session: VoiceCallSession): VoiceCallSession {
    if (!session.leftIds) {
      session.leftIds = [];
    }
    if (!session.declinedIds) {
      session.declinedIds = [];
    }
    if (!session.media) {
      session.media = 'audio';
    }
    if (session.connectedAt === undefined) {
      session.connectedAt = null;
    }
    if (session.onHold == null) {
      session.onHold = false;
    }
    if (session.heldBy === undefined) {
      session.heldBy = null;
    }
    if (session.forceMuted == null) {
      session.forceMuted = false;
    }
    if (session.screenSharerId === undefined) {
      session.screenSharerId = null;
    }
    return session;
  }

  private async persist(
    session: VoiceCallSession,
    ttlSeconds: number,
  ): Promise<void> {
    this.normalize(session);
    const pipeline = this.redis.pipeline();
    pipeline.set(
      this.sessionKey(session.callId),
      JSON.stringify(session),
      'EX',
      ttlSeconds,
    );
    pipeline.set(
      this.convoKey(session.conversationId),
      session.callId,
      'EX',
      ttlSeconds,
    );

    const busyIds = new Set<string>([
      ...session.joinedIds,
      ...this.ringingIds(session),
      session.hostId,
    ]);

    for (const userId of session.memberIds) {
      if (busyIds.has(userId)) {
        pipeline.set(this.userKey(userId), session.callId, 'EX', ttlSeconds);
      } else {
        pipeline.del(this.userKey(userId));
      }
    }
    await pipeline.exec();
  }

  private sessionKey(callId: string): string {
    return `${SESSION_PREFIX}${callId}`;
  }

  private userKey(userId: string): string {
    return `${USER_PREFIX}${userId}`;
  }

  private convoKey(conversationId: string): string {
    return `${CONVO_PREFIX}${conversationId}`;
  }
}
