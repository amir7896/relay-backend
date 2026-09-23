import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Y from 'yjs';
import { CHAT_PATTERNS, type ChannelWhiteboardView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

type RoomDoc = {
  doc: Y.Doc;
  conversationId: string;
  organizationId: string | null;
  dirty: boolean;
  persistTimer: NodeJS.Timeout | null;
  lastActorId: string | null;
  clients: Set<string>;
};

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

@Injectable()
export class WhiteboardCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(WhiteboardCollabService.name);
  private readonly rooms = new Map<string, RoomDoc>();

  constructor(private readonly proxy: MicroserviceProxy) {}

  onModuleDestroy() {
    for (const room of this.rooms.values()) {
      if (room.persistTimer) {
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
      }
      void this.persistRoom(room);
      room.doc.destroy();
    }
    this.rooms.clear();
  }

  async join(
    conversationId: string,
    clientId: string,
    actorId: string,
    organization: { id: string } | null | undefined,
    loadBoard: () => Promise<ChannelWhiteboardView>,
  ): Promise<{ state: string }> {
    const room = await this.ensureRoom(conversationId, organization, loadBoard);
    room.clients.add(clientId);
    room.lastActorId = actorId;
    return {
      state: toBase64(Y.encodeStateAsUpdate(room.doc)),
    };
  }

  leave(conversationId: string, clientId: string): void {
    const room = this.rooms.get(conversationId);
    if (!room) return;
    room.clients.delete(clientId);
    if (room.clients.size === 0) {
      this.schedulePersist(room, 200);
    }
  }

  applyUpdate(
    conversationId: string,
    updateBase64: string,
    actorId: string,
  ): { ok: true } | { ok: false; reason: string } {
    const room = this.rooms.get(conversationId);
    if (!room) {
      return { ok: false, reason: 'Whiteboard room not loaded' };
    }
    if (!updateBase64 || updateBase64.length > 2_000_000) {
      return { ok: false, reason: 'Update too large' };
    }
    try {
      const update = fromBase64(updateBase64);
      Y.applyUpdate(room.doc, update, 'remote');
      room.dirty = true;
      room.lastActorId = actorId;
      this.schedulePersist(room, 1200);
      return { ok: true };
    } catch (error) {
      this.logger.warn(
        `Failed whiteboard update for ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return { ok: false, reason: 'Invalid update' };
    }
  }

  private async ensureRoom(
    conversationId: string,
    organization: { id: string } | null | undefined,
    loadBoard: () => Promise<ChannelWhiteboardView>,
  ): Promise<RoomDoc> {
    const existing = this.rooms.get(conversationId);
    if (existing) return existing;

    const board = await loadBoard();
    const doc = new Y.Doc();
    if (board.ydocState) {
      try {
        Y.applyUpdate(doc, fromBase64(board.ydocState));
      } catch {
        // empty board
      }
    }

    const room: RoomDoc = {
      doc,
      conversationId,
      organizationId: organization?.id ?? (board.organizationId || null),
      dirty: false,
      persistTimer: null,
      lastActorId: board.updatedBy || null,
      clients: new Set(),
    };
    this.rooms.set(conversationId, room);
    return room;
  }

  private schedulePersist(room: RoomDoc, delayMs: number) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
    }
    room.persistTimer = setTimeout(() => {
      room.persistTimer = null;
      void this.persistRoom(room);
    }, delayMs);
  }

  private async persistRoom(room: RoomDoc) {
    if (!room.dirty) return;
    const actorId = room.lastActorId;
    if (!actorId) return;
    const ydocState = toBase64(Y.encodeStateAsUpdate(room.doc));
    room.dirty = false;
    try {
      await this.proxy.sendChat(
        CHAT_PATTERNS.SAVE_WHITEBOARD_YDOC,
        {
          actorId,
          conversationId: room.conversationId,
          ydocState,
          ...(room.organizationId
            ? { organizationId: room.organizationId }
            : {}),
        },
        { skipTenant: !room.organizationId },
      );
    } catch (error) {
      room.dirty = true;
      this.logger.warn(
        `Failed to persist whiteboard ${room.conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}
