import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessageType, PresenceStatus } from '@app/common';
import { AUTH_PATTERNS, CHAT_PATTERNS } from '@app/contracts';
import type {
  ChannelCanvasView,
  ConversationView,
  MessageView,
  OrganizationView,
  PrepareVoiceCallResult,
  SeenResultView,
  SendMessageResult,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { tenantRpcFields } from '../organizations/tenant-context';
import { CallSessionService } from './call-session.service';
import { ConversationCacheService } from './conversation-cache.service';
import { PresenceService } from './presence.service';
import { PushService } from './push.service';
import { WsAuthService } from './ws-auth.service';

type AuthedSocket = Socket & {
  data: {
    userId?: string;
    conversationIds?: string[];
    organization?: OrganizationView;
  };
};

type CallSignalBody = {
  callId?: string;
  conversationId?: string;
  toUserId?: string;
  userIds?: string[];
  media?: 'audio' | 'video';
  /** Ambient channel huddle (no ring) vs normal ringing call. */
  mode?: 'ring' | 'huddle';
  onHold?: boolean;
  muted?: boolean;
  active?: boolean;
  sdp?: Record<string, unknown>;
  candidate?: Record<string, unknown> | null;
};

const MAX_SIGNAL_JSON_BYTES = 64_000;
const RING_TIMEOUT_MS = 45_000;
const CALL_INVITE_WINDOW_MS = 60_000;
const CALL_INVITE_MAX_PER_WINDOW = 5;

@SkipThrottle()
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: true,
    credentials: true,
    allowedHeaders: [
      'authorization',
      'content-type',
      'ngrok-skip-browser-warning',
    ],
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  /** Sliding-window timestamps for call:invite / invite_more rate limits. */
  private readonly inviteRateByUser = new Map<string, number[]>();

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly proxy: MicroserviceProxy,
    private readonly presence: PresenceService,
    private readonly conversationCache: ConversationCacheService,
    private readonly calls: CallSessionService,
    private readonly config: ConfigService,
    private readonly push: PushService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const user = await this.wsAuth.authenticate(client);
      client.data.userId = user.id;
      client.data.conversationIds = [];
      const organizationId =
        typeof client.handshake.auth?.organizationId === 'string'
          ? client.handshake.auth.organizationId
          : undefined;
      if (organizationId) {
        try {
          client.data.organization = await this.proxy.sendAuth<OrganizationView>(
            AUTH_PATTERNS.RESOLVE_TENANT,
            { userId: user.id, organizationId },
            { skipTenant: true },
          );
        } catch {
          client.data.organization = undefined;
        }
      }
      await client.join(`user:${user.id}`);
      const { becameOnline, presence } = await this.presence.connect(
        user.id,
        client.id,
      );
      if (becameOnline) {
        this.server.to(`user:${user.id}`).emit('chat:presence', presence);
      }
    } catch (error) {
      this.logger.debug(
        `Socket ${client.id} rejected: ${error instanceof Error ? error.message : 'unauthorized'}`,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      return;
    }
    const conversationIds = client.data.conversationIds ?? [];
    const result = await this.presence.disconnect(userId, client.id);
    if (result.status === PresenceStatus.OFFLINE) {
      this.broadcastPresenceView(result, conversationIds);
      await this.endCallForDisconnectedUser(userId);
    }
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  private sendChatFor<TResult>(
    client: AuthedSocket,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<TResult> {
    return this.proxy.sendChat<TResult>(
      pattern,
      {
        ...payload,
        ...tenantRpcFields(client.data.organization),
      },
      { skipTenant: true },
    );
  }

  @SubscribeMessage('chat:join')
  async joinConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    const conversation = await this.sendChatFor<ConversationView>(
      client,
      CHAT_PATTERNS.GET_CONVERSATION,
      {
        actorId: userId,
        conversationId,
      },
    );
    const memberIds = conversation.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(conversationId, memberIds);
    await client.join(`conversation:${conversationId}`);
    client.data.conversationIds = [
      ...new Set([...(client.data.conversationIds ?? []), conversationId]),
    ];
    this.emitToMembers(
      'chat:presence',
      {
        userId,
        status: PresenceStatus.ONLINE,
        lastSeenAt: null,
        conversationId,
      },
      conversationId,
      memberIds,
    );
    // Re-sync group call lobby / ring when someone opens the thread mid-call
    await this.pushActiveCallToUser(userId, conversationId);
    return { joined: conversationId };
  }

  @SubscribeMessage('chat:leave')
  async leaveConversationRoom(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    await client.leave(`conversation:${conversationId}`);
    client.data.conversationIds = (client.data.conversationIds ?? []).filter(
      (id: string) => id !== conversationId,
    );
    this.logger.debug(`User ${userId} left conversation room ${conversationId}`);
    return { left: conversationId };
  }

  @SubscribeMessage('chat:message')
  async sendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      conversationId?: string;
      body?: string;
      type?: MessageType;
      replyToMessageId?: string;
      threadRootId?: string;
    },
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    const text = body.body?.trim();
    if (!text) {
      throw new WsException('Message body is required');
    }
    if (body.type === MessageType.CALL) {
      throw new WsException('Call history messages are system-generated only');
    }

    const result = await this.sendChatFor<SendMessageResult>(client, CHAT_PATTERNS.SEND_MESSAGE,
      {
        actorId: userId,
        conversationId,
        body: text,
        type: body.type ?? MessageType.TEXT,
        replyToMessageId: body.replyToMessageId,
        threadRootId: body.threadRootId,
      },
    );
    const {
      recipientIds,
      mutedRecipientIds: _muted,
      connectFanouts,
      ...message
    } = result;
    await this.conversationCache.setMemberIds(conversationId, recipientIds);
    this.broadcastMessage(message, recipientIds);
    for (const fanout of connectFanouts ?? []) {
      this.broadcastMessage(
        { ...message, conversationId: fanout.conversationId },
        fanout.recipientIds,
      );
    }
    void this.sendChatFor(client, CHAT_PATTERNS.DISPATCH_OUTGOING_WEBHOOKS, {
      conversationId: message.conversationId,
      event: 'message.created' as const,
      message: {
        id: message.id,
        body: message.body ?? null,
        senderId: message.senderId,
        type: message.type,
        createdAt: message.createdAt,
        botUsername: message.botUsername ?? null,
      },
    }).catch(() => undefined);
    void this.evaluateChannelWorkflows(client, userId, conversationId, message);
    return { ...message, conversationId };
  }

  @SubscribeMessage('chat:typing')
  async typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; typing?: boolean },
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    const memberIds = await this.memberIdsFor(userId, conversationId);
    this.broadcastTyping(
      conversationId,
      userId,
      body.typing !== false,
      memberIds,
    );
    return { ok: true };
  }

  @SubscribeMessage('chat:seen')
  async markSeen(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; messageId?: string },
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    const result = await this.sendChatFor<SeenResultView>(client, CHAT_PATTERNS.MARK_SEEN,
      {
        actorId: userId,
        conversationId,
        messageId: body.messageId,
      },
    );
    const { recipientIds, ...seen } = result;
    await this.conversationCache.setMemberIds(conversationId, recipientIds);
    this.broadcastSeen(seen, recipientIds);
    return seen;
  }

  @SubscribeMessage('chat:heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthedSocket) {
    const userId = this.requireUser(client);
    await this.presence.heartbeat(userId);
    const presence = await this.presence.getPresence(userId);
    return { ok: true, status: presence.status };
  }

  @SubscribeMessage('chat:presence_set')
  async setPresence(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      status?: string;
      customStatus?: string | null;
      statusClearsAt?: string | null;
    },
  ) {
    const userId = this.requireUser(client);
    const allowed = new Set([
      PresenceStatus.ONLINE,
      PresenceStatus.AWAY,
      PresenceStatus.BUSY,
      PresenceStatus.DND,
    ]);
    const status = (body.status as PresenceStatus) || PresenceStatus.ONLINE;
    if (!allowed.has(status)) {
      return { status: 'error', message: 'Invalid presence status' };
    }
    let statusClearsAt: string | null | undefined = body.statusClearsAt;
    if (statusClearsAt !== undefined && statusClearsAt !== null) {
      const parsed = new Date(statusClearsAt);
      if (Number.isNaN(parsed.getTime())) {
        return { status: 'error', message: 'Invalid statusClearsAt' };
      }
      statusClearsAt = parsed.toISOString();
    }
    const presence = await this.presence.setStatus(
      userId,
      status,
      body.customStatus,
      statusClearsAt,
    );
    this.broadcastPresenceView(
      presence,
      client.data.conversationIds ?? [],
    );
    return presence;
  }

  // ── Voice call signaling (1:1 + group mesh via WebRTC) ────────────────────

  @SubscribeMessage('call:invite')
  async inviteCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const conversationId = this.requireConversationId(body);
    const rateError = this.takeCallInviteSlot(userId);
    if (rateError) {
      return { status: 'error', message: rateError };
    }

    const prepared = await this.sendChatFor<PrepareVoiceCallResult>(client, CHAT_PATTERNS.PREPARE_VOICE_CALL,
      { actorId: userId, conversationId },
    );

    const media = body.media === 'video' ? 'video' : 'audio';
    const mode = body.mode === 'huddle' ? 'huddle' : 'ring';
    if (mode === 'huddle' && prepared.kind !== 'group' && prepared.kind !== 'private') {
      return { status: 'error', message: 'Huddles are only available in channels and DMs' };
    }
    const created = await this.calls.createCall({
      conversationId: prepared.conversationId,
      kind: prepared.kind,
      hostId: userId,
      memberIds: prepared.memberIds,
      media: mode === 'huddle' ? 'audio' : media,
      mode,
    });
    // Return error via ACK (Nest WsException emits "exception" and never nacks the ACK,
    // which left the caller UI stuck on "Calling…" with no peer ring).
    if ('error' in created) {
      return { status: 'error', message: created.error };
    }

    this.logger.log(
      `call:invite ${created.callId} kind=${created.kind} mode=${created.mode} media=${created.media} host=${userId} peers=${prepared.peerIds.join(',')}`,
    );

    // Huddles: silent hop-in — lobby only, no ring / push / timeout.
    this.emitCallLobby(created);
    this.emitCallRoster(created);

    if (mode !== 'huddle') {
      const incoming = {
        callId: created.callId,
        conversationId: created.conversationId,
        fromUserId: userId,
        kind: created.kind,
        media: created.media,
        mode: created.mode,
        memberIds: created.memberIds,
        joinedIds: created.joinedIds,
      };
      // User rooms only — conversation rooms can retain removed members.
      this.broadcastToCallMembers(prepared.peerIds, 'call:incoming', incoming);

      const mediaLabel = created.media === 'video' ? 'Video' : 'Voice';
      const kindLabel = created.kind === 'group' ? 'group ' : '';
      void this.push.notifyCallInvite({
        recipientIds: prepared.peerIds,
        senderId: userId,
        title: `Incoming ${kindLabel}${mediaLabel.toLowerCase()} call`,
        body: `${mediaLabel} call — tap to open Relay`,
        conversationId: created.conversationId,
        callId: created.callId,
        media: created.media,
        kind: created.kind,
      });

      this.clearRingTimer(created.callId);
      const timer = setTimeout(() => {
        void this.timeoutRingingCall(created.callId);
      }, RING_TIMEOUT_MS);
      this.ringTimers.set(created.callId, timer);
    }

    return {
      callId: created.callId,
      conversationId: created.conversationId,
      kind: created.kind,
      media: created.media,
      mode: created.mode,
      peerIds: prepared.peerIds,
      memberIds: created.memberIds,
      joinedIds: created.joinedIds,
      status: created.status,
    };
  }

  @SubscribeMessage('call:accept')
  async acceptCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const existing = await this.calls.get(callId);
    if (!existing || existing.status === 'ended') {
      throw new WsException('Call is no longer available');
    }
    await this.assertLiveConversationMember(userId, existing.conversationId);

    const accepted = await this.calls.accept(callId, userId);
    if ('error' in accepted) {
      throw new WsException(accepted.error);
    }

    if (accepted.kind === 'private' || accepted.joinedIds.length > 1) {
      this.clearRingTimer(callId);
    }

    const payload = {
      callId,
      conversationId: accepted.conversationId,
      kind: accepted.kind,
      byUserId: userId,
      joinedIds: accepted.joinedIds,
      memberIds: accepted.memberIds,
    };

    for (const memberId of accepted.memberIds) {
      this.emitCallEventToUser(memberId, 'call:participant_joined', payload);
    }
    // Backward-compatible event for existing 1:1 client paths
    for (const memberId of accepted.joinedIds) {
      this.emitCallEventToUser(memberId, 'call:accepted', payload);
    }
    this.emitCallLobby(accepted);
    this.emitCallRoster(accepted);
    return payload;
  }

  @SubscribeMessage('call:reject')
  async rejectCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const result = await this.calls.decline(callId, userId);
    if ('error' in result) {
      throw new WsException(result.error);
    }

    if (result.ended) {
      this.clearRingTimer(callId);
      this.emitCallEnded(result.session, userId, 'rejected');
    } else {
      this.broadcastToCallMembers(result.session.memberIds, 'call:declined', {
        callId,
        conversationId: result.session.conversationId,
        byUserId: userId,
      });
      // Keep lobby alive so decliner (and others) can Join again
      this.emitCallLobby(result.session);
      this.emitCallRoster(result.session);
    }
    return {
      ok: true,
      ended: result.ended,
      lobby: result.ended ? null : this.calls.toLobby(result.session),
    };
  }

  @SubscribeMessage('call:hangup')
  async hangupCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const session = await this.calls.get(callId);
    if (!session) {
      return { ok: true };
    }
    if (!this.calls.isMember(session, userId)) {
      throw new WsException('You are not part of this call');
    }

    const result = await this.calls.leave(callId, userId);
    if ('error' in result) {
      throw new WsException(result.error);
    }

    if (result.ended) {
      this.clearRingTimer(callId);
      this.emitCallEnded(result.session, userId, 'hangup');
    } else {
      for (const memberId of result.session.memberIds) {
        this.server.to(`user:${memberId}`).emit('call:participant_left', {
          callId,
          conversationId: result.session.conversationId,
          byUserId: userId,
          joinedIds: result.remainingIds,
        });
      }
      this.emitCallLobby(result.session);
      this.emitCallRoster(result.session);
    }
    return {
      ok: true,
      ended: result.ended,
      lobby: result.ended ? null : this.calls.toLobby(result.session),
    };
  }

  @SubscribeMessage('call:offer')
  async relayOffer(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    await this.relayWebRtcSignal(client, body, 'offer', 'call:offer');
    return { ok: true };
  }

  @SubscribeMessage('call:answer')
  async relayAnswer(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    await this.relayWebRtcSignal(client, body, 'answer', 'call:answer');
    return { ok: true };
  }

  @SubscribeMessage('call:ice')
  async relayIce(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const toUserId = this.requireToUserId(body);
    this.assertSignalSize(body.candidate);
    const session = await this.requireJoinedParticipant(callId, userId);
    if (!this.calls.isJoined(session, toUserId)) {
      throw new WsException('Peer is not in this call');
    }
    this.server.to(`user:${toUserId}`).emit('call:ice', {
      callId,
      fromUserId: userId,
      toUserId,
      candidate: body.candidate ?? null,
    });
    return { ok: true };
  }

  /** Put call on hold / resume (1:1 and group). */
  @SubscribeMessage('call:hold')
  async holdCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const onHold = Boolean(body.onHold);
    const existing = await this.calls.get(callId);
    if (!existing || existing.status === 'ended') {
      return { status: 'error', message: 'Call is no longer available' };
    }
    await this.assertLiveConversationMember(userId, existing.conversationId);
    const session = await this.calls.setHold(callId, userId, onHold);
    if ('error' in session) {
      return { status: 'error', message: session.error };
    }
    const payload = {
      callId,
      conversationId: session.conversationId,
      onHold: session.onHold,
      heldBy: session.heldBy,
      byUserId: userId,
    };
    this.broadcastToCallMembers(session.memberIds, 'call:held', payload);
    this.emitCallLobby(session);
    this.emitCallRoster(session);
    return payload;
  }

  /** Host mute-everyone (clients mute local mic). */
  @SubscribeMessage('call:mute_all')
  async muteAllCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const muted = Boolean(body.muted);
    const existing = await this.calls.get(callId);
    if (!existing || existing.status === 'ended') {
      return { status: 'error', message: 'Call is no longer available' };
    }
    await this.assertLiveConversationMember(userId, existing.conversationId);
    const session = await this.calls.setForceMute(callId, userId, muted);
    if ('error' in session) {
      return { status: 'error', message: session.error };
    }
    const payload = {
      callId,
      conversationId: session.conversationId,
      muted: session.forceMuted,
      byUserId: userId,
    };
    this.broadcastToCallMembers(session.memberIds, 'call:force_mute', payload);
    this.emitCallLobby(session);
    this.emitCallRoster(session);
    return payload;
  }

  /** Mid-call invite for group members not currently ringing/joined. */
  @SubscribeMessage('call:invite_more')
  async inviteMoreCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const rateError = this.takeCallInviteSlot(userId);
    if (rateError) {
      return { status: 'error', message: rateError };
    }
    const callId = this.requireCallId(body);
    const userIds = Array.isArray(body.userIds)
      ? body.userIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (userIds.length === 0) {
      return { status: 'error', message: 'Select at least one member' };
    }

    const session = await this.calls.get(callId);
    if (!session || session.status === 'ended') {
      return { status: 'error', message: 'Call is no longer available' };
    }
    await this.assertLiveConversationMember(userId, session.conversationId);

    const prepared = await this.sendChatFor<PrepareVoiceCallResult>(client, CHAT_PATTERNS.PREPARE_VOICE_CALL,
      { actorId: userId, conversationId: session.conversationId },
    );

    const result = await this.calls.inviteMore(
      callId,
      userId,
      userIds,
      prepared.memberIds,
    );
    if ('error' in result) {
      return { status: 'error', message: result.error };
    }

    const incoming = {
      callId: result.session.callId,
      conversationId: result.session.conversationId,
      fromUserId: userId,
      kind: result.session.kind,
      media: result.session.media,
      memberIds: result.session.memberIds,
      joinedIds: result.session.joinedIds,
    };

    this.broadcastToCallMembers(result.invitedIds, 'call:incoming', incoming);

    const mediaLabel = result.session.media === 'video' ? 'Video' : 'Voice';
    void this.push.notifyCallInvite({
      recipientIds: result.invitedIds,
      senderId: userId,
      title: `Incoming group ${mediaLabel.toLowerCase()} call`,
      body: `${mediaLabel} call — tap to open Relay`,
      conversationId: result.session.conversationId,
      callId: result.session.callId,
      media: result.session.media,
      kind: result.session.kind,
    });

    this.clearRingTimer(callId);
    const timer = setTimeout(() => {
      void this.timeoutRingingInvitees(callId, result.invitedIds);
    }, RING_TIMEOUT_MS);
    this.ringTimers.set(callId, timer);

    this.emitCallLobby(result.session);
    this.emitCallRoster(result.session);
    return {
      ok: true,
      invitedIds: result.invitedIds,
      memberIds: result.session.memberIds,
      roster: this.calls.toRoster(result.session),
    };
  }

  /** Announce screen-share state for UI (media is WebRTC track replace). */
  @SubscribeMessage('call:screen_share')
  async screenShareCall(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CallSignalBody,
  ) {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const active = Boolean(body.active);
    const existing = await this.calls.get(callId);
    if (!existing || existing.status === 'ended') {
      return { status: 'error', message: 'Call is no longer available' };
    }
    await this.assertLiveConversationMember(userId, existing.conversationId);
    const session = await this.calls.setScreenShare(callId, userId, active);
    if ('error' in session) {
      return { status: 'error', message: session.error };
    }
    const payload = {
      callId,
      conversationId: session.conversationId,
      active: Boolean(session.screenSharerId),
      byUserId: session.screenSharerId ?? userId,
    };
    this.broadcastToCallMembers(session.memberIds, 'call:screen_share', payload);
    this.emitCallLobby(session);
    this.emitCallRoster(session);
    return payload;
  }

  getIceServers(): Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }> {
    const stunRaw = this.config.get<string>(
      'WEBRTC_STUN_URLS',
      'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
    );
    const servers: Array<{
      urls: string | string[];
      username?: string;
      credential?: string;
    }> = stunRaw
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((urls) => ({ urls }));

    const turnUrls = this.config.get<string>('WEBRTC_TURN_URLS', '');
    const turnUsername = this.config.get<string>('WEBRTC_TURN_USERNAME', '');
    const turnCredential = this.config.get<string>('WEBRTC_TURN_CREDENTIAL', '');
    if (turnUrls.trim() && turnUsername && turnCredential) {
      servers.push({
        urls: turnUrls
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean),
        username: turnUsername,
        credential: turnCredential,
      });
    } else if (this.config.get<string>('WEBRTC_USE_DEMO_TURN', 'true') !== 'false') {
      // Open Relay free TURN for local/dev NAT traversal (replace in production).
      servers.push({
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      });
    }
    return servers;
  }

  broadcastMessage(message: MessageView, recipientIds: string[] = []): void {
    this.emitToMembers(
      'chat:message',
      message,
      message.conversationId,
      recipientIds,
    );
  }

  emitReminder(
    userId: string,
    payload: {
      id: string;
      conversationId: string;
      messageId: string;
      bodySnippet: string;
      remindAt: string;
    },
  ): void {
    if (!this.server) {
      return;
    }
    this.server.to(`user:${userId}`).emit('chat:reminder', payload);
  }

  emitUserNotification(
    userId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.server) {
      return;
    }
    this.server.to(`user:${userId}`).emit('chat:notification', payload);
  }

  broadcastMessageDeleted(
    message: MessageView,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:message_deleted',
      message,
      message.conversationId,
      recipientIds,
    );
  }

  broadcastCanvas(
    canvas: ChannelCanvasView,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:canvas',
      canvas,
      canvas.conversationId,
      recipientIds,
    );
  }

  private async evaluateChannelWorkflows(
    client: AuthedSocket,
    actorId: string,
    conversationId: string,
    message: MessageView,
  ): Promise<void> {
    try {
      const result = await this.sendChatFor<{
        messages?: Array<MessageView & { recipientIds?: string[] }>;
      }>(client, CHAT_PATTERNS.EVALUATE_WORKFLOWS, {
        actorId,
        conversationId,
        triggerType: 'message_contains',
        message: {
          id: message.id,
          body: message.body ?? '',
          senderId: message.senderId,
          botUsername: message.botUsername ?? null,
          conversationId: message.conversationId,
        },
      });
      for (const item of result.messages ?? []) {
        const { recipientIds, ...view } = item;
        this.broadcastMessage(view, recipientIds ?? []);
      }
    } catch {
      // ignore workflow failures on the socket path
    }
  }

  broadcastTyping(
    conversationId: string,
    userId: string,
    typing: boolean,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:typing',
      { conversationId, userId, typing },
      conversationId,
      recipientIds,
    );
  }

  broadcastSeen(
    result: Omit<SeenResultView, 'recipientIds'>,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:seen',
      result,
      result.conversationId,
      recipientIds,
    );
  }

  /** Peer marked unread — rewind their read receipts on open threads. */
  broadcastUnseen(
    result: Omit<SeenResultView, 'recipientIds'>,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:unseen',
      result,
      result.conversationId,
      recipientIds,
    );
  }

  broadcastPresence(
    userId: string,
    status: PresenceStatus,
    lastSeenAt: string | null,
    conversationIds: string[],
    customStatus: string | null = null,
  ): void {
    this.broadcastPresenceView(
      { userId, status, lastSeenAt, customStatus },
      conversationIds,
    );
  }

  broadcastPresenceView(
    presence: {
      userId: string;
      status: PresenceStatus;
      lastSeenAt: string | null;
      customStatus?: string | null;
      statusClearsAt?: string | null;
    },
    conversationIds: string[],
  ): void {
    if (!this.server) {
      return;
    }
    const payload = {
      userId: presence.userId,
      status: presence.status,
      lastSeenAt: presence.lastSeenAt,
      customStatus: presence.customStatus ?? null,
      statusClearsAt: presence.statusClearsAt ?? null,
    };
    this.server.to(`user:${presence.userId}`).emit('chat:presence', payload);
    void this.fanOutPresence(payload, conversationIds);
  }

  /** Broadcast presence without known conversation list (REST). */
  emitPresenceUpdate(presence: {
    userId: string;
    status: PresenceStatus;
    lastSeenAt: string | null;
    customStatus?: string | null;
    statusClearsAt?: string | null;
  }): void {
    if (!this.server) {
      return;
    }
    this.server.emit('chat:presence', {
      userId: presence.userId,
      status: presence.status,
      lastSeenAt: presence.lastSeenAt,
      customStatus: presence.customStatus ?? null,
      statusClearsAt: presence.statusClearsAt ?? null,
    });
  }

  private async fanOutPresence(
    payload: {
      userId: string;
      status: PresenceStatus;
      lastSeenAt: string | null;
      customStatus?: string | null;
      conversationId?: string;
    },
    conversationIds: string[],
  ): Promise<void> {
    if (!this.server || conversationIds.length === 0) {
      return;
    }
    const peerIds = new Set<string>();
    for (const conversationId of conversationIds) {
      this.server.to(`conversation:${conversationId}`).emit('chat:presence', {
        ...payload,
        conversationId,
      });
      const members = await this.conversationCache.getMemberIds(conversationId);
      for (const memberId of members ?? []) {
        if (memberId !== payload.userId) {
          peerIds.add(memberId);
        }
      }
    }
    for (const peerId of peerIds) {
      this.server.to(`user:${peerId}`).emit('chat:presence', payload);
    }
  }

  broadcastGroupDeleted(
    conversationId: string,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:group_deleted',
      { conversationId },
      conversationId,
      recipientIds,
    );
  }

  /** Push full conversation to member inboxes (add-to-group, create group, roster changes). */
  broadcastConversationUpdated(
    conversation: ConversationView,
    recipientIds: string[] = [],
  ): void {
    this.emitToMembers(
      'chat:conversation_updated',
      conversation,
      conversation.id,
      recipientIds,
    );
  }

  /** Tell a user the group was removed from their membership. */
  broadcastRemovedFromGroup(
    conversationId: string,
    recipientIds: string[],
  ): void {
    if (!this.server || recipientIds.length === 0) {
      return;
    }
    for (const userId of recipientIds) {
      this.server.to(`user:${userId}`).emit('chat:removed_from_group', {
        conversationId,
      });
    }
  }

  /**
   * Evict sockets from the conversation room, revoke Redis call membership,
   * and notify remaining callers.
   */
  async evictUsersFromConversation(
    conversationId: string,
    userIds: string[],
  ): Promise<void> {
    for (const userId of userIds) {
      await this.forceLeaveConversationRoom(conversationId, userId);
      const revoked = await this.calls.revokeUserFromConversation(
        conversationId,
        userId,
      );
      if (!revoked) {
        continue;
      }
      this.emitCallEventToUser(userId, 'call:ended', {
        callId: revoked.callId,
        conversationId,
        byUserId: userId,
        reason: 'removed',
      });
      if (revoked.ended) {
        this.clearRingTimer(revoked.callId);
        this.emitCallEnded(revoked.session, userId, 'hangup');
      } else {
        this.broadcastToCallMembers(
          revoked.session.memberIds,
          'call:participant_left',
          {
            callId: revoked.callId,
            conversationId,
            byUserId: userId,
            remainingIds: revoked.remainingIds,
          },
        );
        this.emitCallLobby(revoked.session);
        this.emitCallRoster(revoked.session);
      }
    }
  }

  private async forceLeaveConversationRoom(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    if (!this.server) {
      return;
    }
    try {
      const sockets = await this.server.in(`user:${userId}`).fetchSockets();
      for (const socket of sockets) {
        await socket.leave(`conversation:${conversationId}`);
        const data = socket.data as { conversationIds?: string[] };
        data.conversationIds = (data.conversationIds ?? []).filter(
          (id: string) => id !== conversationId,
        );
      }
    } catch (error) {
      this.logger.debug(
        `Failed to leave conversation room for ${userId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async sendChatAsUser<TResult>(
    userId: string,
    pattern: string,
    payload: Record<string, unknown>,
  ): Promise<TResult> {
    let organization: OrganizationView | undefined;
    if (this.server) {
      try {
        const sockets = await this.server.in(`user:${userId}`).fetchSockets();
        organization = (
          sockets[0]?.data as { organization?: OrganizationView } | undefined
        )?.organization;
      } catch {
        organization = undefined;
      }
    }
    return this.proxy.sendChat<TResult>(
      pattern,
      {
        ...payload,
        ...tenantRpcFields(organization),
      },
      { skipTenant: true },
    );
  }

  private async assertLiveConversationMember(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      await this.sendChatAsUser<ConversationView>(
        userId,
        CHAT_PATTERNS.GET_CONVERSATION,
        {
          actorId: userId,
          conversationId,
        },
      );
    } catch {
      throw new WsException('You are no longer a member of this conversation');
    }
  }

  private takeCallInviteSlot(userId: string): string | null {
    const now = Date.now();
    const recent = (this.inviteRateByUser.get(userId) ?? []).filter(
      (ts) => now - ts < CALL_INVITE_WINDOW_MS,
    );
    if (recent.length >= CALL_INVITE_MAX_PER_WINDOW) {
      return 'Too many call invites. Please wait a moment.';
    }
    recent.push(now);
    this.inviteRateByUser.set(userId, recent);
    return null;
  }

  private async relayWebRtcSignal(
    client: AuthedSocket,
    body: CallSignalBody,
    kind: 'offer' | 'answer',
    event: 'call:offer' | 'call:answer',
  ): Promise<void> {
    const userId = this.requireUser(client);
    const callId = this.requireCallId(body);
    const toUserId = this.requireToUserId(body);
    if (!body.sdp || typeof body.sdp !== 'object') {
      throw new WsException(`${kind} SDP is required`);
    }
    this.assertSignalSize(body.sdp);
    const session = await this.requireJoinedParticipant(callId, userId);
    if (!this.calls.isJoined(session, toUserId)) {
      throw new WsException('Peer is not in this call');
    }
    if (toUserId === userId) {
      throw new WsException('Invalid signaling target');
    }

    this.server.to(`user:${toUserId}`).emit(event, {
      callId,
      fromUserId: userId,
      toUserId,
      sdp: body.sdp,
    });
  }

  private async requireJoinedParticipant(callId: string, userId: string) {
    const session = await this.calls.get(callId);
    if (!session || session.status === 'ended') {
      throw new WsException('Call is not active');
    }
    if (!this.calls.isJoined(session, userId)) {
      throw new WsException('You are not in this call');
    }
    await this.assertLiveConversationMember(userId, session.conversationId);
    return session;
  }

  private emitCallEventToUser(
    userId: string,
    event: string,
    payload: unknown,
  ): void {
    if (!this.server) {
      return;
    }
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  private emitCallLobby(session: {
    callId: string;
    conversationId: string;
    kind: 'private' | 'group';
    hostId: string;
    memberIds: string[];
    joinedIds: string[];
  }): void {
    // Lobby / rejoin is for group calls (WhatsApp-style Join)
    if (session.kind !== 'group') {
      return;
    }
    if (!this.server) {
      return;
    }
    const full = this.calls.toLobby(session as never, true);
    this.broadcastToCallMembers(session.memberIds, 'call:lobby', full);
  }

  private emitCallRoster(session: {
    callId: string;
    conversationId: string;
    memberIds: string[];
  }): void {
    if (!this.server) {
      return;
    }
    const roster = this.calls.toRoster(session as never);
    this.broadcastToCallMembers(session.memberIds, 'call:roster', roster);
  }

  private broadcastToCallMembers(
    memberIds: string[],
    event: string,
    payload: unknown,
  ): void {
    for (const memberId of memberIds) {
      this.emitCallEventToUser(memberId, event, payload);
    }
  }

  /** Soft-timeout for mid-call invitees: mark unanswered as left (no auto-ring), keep call. */
  private async timeoutRingingInvitees(
    callId: string,
    invitedIds: string[],
  ): Promise<void> {
    this.clearRingTimer(callId);
    const session = await this.calls.markUnansweredAsLeft(callId, invitedIds);
    if (!session) {
      return;
    }
    this.emitCallLobby(session);
    this.emitCallRoster(session);
  }

  /** When a member opens/joins a group thread, catch them up on a live call. */
  private async pushActiveCallToUser(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const session = await this.calls.getByConversation(conversationId);
    if (
      !session ||
      session.kind !== 'group' ||
      session.status === 'ended' ||
      !session.memberIds.includes(userId) ||
      session.joinedIds.length === 0
    ) {
      return;
    }

    this.emitCallEventToUser(
      userId,
      'call:lobby',
      this.calls.toLobby(session, true),
    );

    const stillRinging =
      !session.joinedIds.includes(userId) &&
      !session.declinedIds.includes(userId) &&
      !(session.leftIds ?? []).includes(userId) &&
      session.status === 'ringing';

    if (stillRinging) {
      this.emitCallEventToUser(userId, 'call:incoming', {
        callId: session.callId,
        conversationId: session.conversationId,
        fromUserId: session.hostId,
        kind: session.kind,
        media: session.media ?? 'audio',
        memberIds: session.memberIds,
        joinedIds: session.joinedIds,
      });
    }
  }

  private emitCallEnded(
    session: {
      callId: string;
      conversationId: string;
      kind?: 'private' | 'group';
      media?: 'audio' | 'video';
      hostId?: string;
      memberIds: string[];
      joinedIds?: string[];
      connectedAt?: string | null;
      createdAt?: string;
      declinedIds?: string[];
    },
    byUserId: string,
    reason: 'hangup' | 'rejected' | 'timeout' | 'offline',
  ): void {
    const payload = {
      callId: session.callId,
      conversationId: session.conversationId,
      byUserId,
      reason,
    };
    for (const memberId of session.memberIds) {
      this.emitCallEventToUser(memberId, 'call:ended', payload);
      if (session.kind === 'group') {
        this.emitCallEventToUser(memberId, 'call:lobby', {
          callId: session.callId,
          conversationId: session.conversationId,
          kind: 'group',
          media: session.media ?? 'audio',
          hostId: byUserId,
          memberIds: session.memberIds,
          joinedIds: [],
          declinedIds: [],
          leftIds: [],
          ringingIds: [],
          onHold: false,
          heldBy: null,
          forceMuted: false,
          screenSharerId: null,
          active: false,
        });
      }
    }
    if (session.kind === 'group' && this.server) {
      this.server.to(`conversation:${session.conversationId}`).emit('call:ended', payload);
      this.server.to(`conversation:${session.conversationId}`).emit('call:lobby', {
        callId: session.callId,
        conversationId: session.conversationId,
        kind: 'group',
        media: session.media ?? 'audio',
        hostId: byUserId,
        memberIds: session.memberIds,
        joinedIds: [],
        declinedIds: [],
        leftIds: [],
        ringingIds: [],
        onHold: false,
        heldBy: null,
        forceMuted: false,
        screenSharerId: null,
        active: false,
      });
    }
    void this.recordCallHistoryMessage(session, byUserId, reason);
  }

  private async recordCallHistoryMessage(
    session: {
      callId: string;
      conversationId: string;
      kind?: 'private' | 'group';
      media?: 'audio' | 'video';
      hostId?: string;
      memberIds: string[];
      joinedIds?: string[];
      connectedAt?: string | null;
      createdAt?: string;
      declinedIds?: string[];
    },
    byUserId: string,
    reason: 'hangup' | 'rejected' | 'timeout' | 'offline',
  ): Promise<void> {
    try {
      const media = session.media === 'video' ? 'video' : 'audio';
      const kind = session.kind === 'group' ? 'group' : 'private';
      const hadConversation =
        Boolean(session.connectedAt) ||
        (session.joinedIds?.length ?? 0) >= 2 ||
        (kind === 'group' && (session.joinedIds?.length ?? 0) >= 1 && reason !== 'timeout');

      let outcome: 'completed' | 'missed' | 'declined' | 'cancelled' = 'completed';
      if (reason === 'rejected') {
        outcome = 'declined';
      } else if (reason === 'timeout') {
        outcome = hadConversation ? 'completed' : 'missed';
      } else if (reason === 'hangup' || reason === 'offline') {
        outcome = hadConversation ? 'completed' : 'cancelled';
      }

      // Group ringing with only host never really "completed"
      if (
        kind === 'group' &&
        outcome === 'completed' &&
        (session.joinedIds?.length ?? 0) <= 1 &&
        !session.connectedAt
      ) {
        outcome = reason === 'timeout' ? 'missed' : 'cancelled';
      }

      const durationSeconds =
        outcome === 'completed' && session.connectedAt
          ? Math.max(
              0,
              Math.round(
                (Date.now() - new Date(session.connectedAt).getTime()) / 1000,
              ),
            )
          : 0;

      const body = JSON.stringify({
        v: 1,
        callId: session.callId,
        kind,
        media,
        outcome,
        durationSeconds,
        reason,
        byUserId,
      });

      const actorId = session.hostId || byUserId;
      const result = await this.sendChatAsUser<SendMessageResult>(
        actorId,
        CHAT_PATTERNS.SEND_MESSAGE,
        {
          actorId,
          conversationId: session.conversationId,
          body,
          type: MessageType.CALL,
          systemCall: true,
        },
      );
      const { recipientIds, mutedRecipientIds: _muted, ...message } = result;
      await this.conversationCache.setMemberIds(
        session.conversationId,
        recipientIds,
      );
      this.emitToMembers(
        'chat:message',
        message,
        session.conversationId,
        recipientIds,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to record call history: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async finishCall(
    callId: string,
    byUserId: string,
    reason: 'hangup' | 'rejected' | 'timeout' | 'offline',
  ): Promise<void> {
    const ended = await this.calls.end(callId);
    this.clearRingTimer(callId);
    if (!ended) {
      return;
    }
    this.emitCallEnded(ended, byUserId, reason);
  }

  private async timeoutRingingCall(callId: string): Promise<void> {
    const session = await this.calls.get(callId);
    if (!session) {
      return;
    }
    // Group: if at least 2 people joined, keep the call and just stop ringing.
    if (session.kind === 'group' && session.joinedIds.length >= 2) {
      this.clearRingTimer(callId);
      return;
    }
    // Private or unanswered group → end
    if (session.joinedIds.length <= 1 && this.calls.ringingIds(session).length > 0) {
      await this.finishCall(callId, session.hostId, 'timeout');
    }
  }

  private async endCallForDisconnectedUser(userId: string): Promise<void> {
    const callId = await this.calls.getActiveCallIdForUser(userId);
    if (!callId) {
      return;
    }
    const session = await this.calls.get(callId);
    if (!session) {
      await this.calls.clearUserBusy(userId, callId);
      return;
    }

    // Ringing invitees who never joined: release busy flag only — keep them
    // eligible for re-ring / Join when they reconnect (do not mark as left).
    if (!session.joinedIds.includes(userId)) {
      await this.calls.clearUserBusy(userId, callId);
      return;
    }

    // Brief socket blips (HMR, tab freeze, proxy) are common — wait before ending.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const stillGone = (await this.presence.getPresence(userId)).status ===
      PresenceStatus.OFFLINE;
    if (!stillGone) {
      return;
    }
    const latest = await this.calls.get(callId);
    if (!latest || !latest.joinedIds.includes(userId)) {
      return;
    }

    const result = await this.calls.leave(callId, userId);
    if ('error' in result) {
      return;
    }
    if (result.ended) {
      this.clearRingTimer(callId);
      this.emitCallEnded(result.session, userId, 'offline');
    } else {
      for (const memberId of result.session.memberIds) {
        this.emitCallEventToUser(memberId, 'call:participant_left', {
          callId,
          conversationId: result.session.conversationId,
          byUserId: userId,
          joinedIds: result.remainingIds,
        });
      }
      this.emitCallLobby(result.session);
      this.emitCallRoster(result.session);
    }
  }

  private clearRingTimer(callId: string): void {
    const timer = this.ringTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringTimers.delete(callId);
    }
  }

  private assertSignalSize(payload: unknown): void {
    try {
      const size = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
      if (size > MAX_SIGNAL_JSON_BYTES) {
        throw new WsException('Signal payload is too large');
      }
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }
      throw new WsException('Invalid signal payload');
    }
  }

  private emitToMembers(
    event: string,
    payload: unknown,
    conversationId: string,
    recipientIds: string[],
  ): void {
    if (!this.server) {
      return;
    }
    // Prefer per-user rooms so removed members who still sit in conversation:*
    // do not keep receiving member-only updates (roster, messages, call lobby).
    const rooms =
      recipientIds.length > 0
        ? recipientIds.map((id) => `user:${id}`)
        : [`conversation:${conversationId}`];
    this.server.to(rooms).emit(event, payload);
  }

  private async memberIdsFor(
    actorId: string,
    conversationId: string,
  ): Promise<string[]> {
    const cached = await this.conversationCache.getMemberIds(conversationId);
    if (cached) {
      return cached;
    }
    const conversation = await this.sendChatAsUser<ConversationView>(
      actorId,
      CHAT_PATTERNS.GET_CONVERSATION,
      { actorId, conversationId },
    );
    const memberIds = conversation.members.map((member) => member.userId);
    await this.conversationCache.setMemberIds(conversationId, memberIds);
    return memberIds;
  }

  private requireUser(client: AuthedSocket): string {
    if (!client.data.userId) {
      throw new WsException('Authentication is required');
    }
    return client.data.userId;
  }

  private requireConversationId(body: { conversationId?: string }): string {
    if (!body?.conversationId) {
      throw new WsException('conversationId is required');
    }
    return body.conversationId;
  }

  private requireCallId(body: { callId?: string }): string {
    if (!body?.callId || typeof body.callId !== 'string') {
      throw new WsException('callId is required');
    }
    return body.callId;
  }

  private requireToUserId(body: { toUserId?: string }): string {
    if (!body?.toUserId || typeof body.toUserId !== 'string') {
      throw new WsException('toUserId is required');
    }
    return body.toUserId;
  }
}
