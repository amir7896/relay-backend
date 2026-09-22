import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Y from 'yjs';
import { CHAT_PATTERNS, type ChannelCanvasView } from '@app/contracts';
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
export class CanvasCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(CanvasCollabService.name);
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
    loadCanvas: () => Promise<ChannelCanvasView>,
  ): Promise<{ state: string; title: string; body: string }> {
    const room = await this.ensureRoom(conversationId, organization, loadCanvas);
    room.clients.add(clientId);
    room.lastActorId = actorId;
    return {
      state: toBase64(Y.encodeStateAsUpdate(room.doc)),
      title: String(room.doc.getText('title').toString()),
      body: String(room.doc.getText('body').toString()),
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
      return { ok: false, reason: 'Canvas room not loaded' };
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
        `Failed canvas update for ${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return { ok: false, reason: 'Invalid update' };
    }
  }

  encodeState(conversationId: string): string | null {
    const room = this.rooms.get(conversationId);
    if (!room) return null;
    return toBase64(Y.encodeStateAsUpdate(room.doc));
  }

  private async ensureRoom(
    conversationId: string,
    organization: { id: string } | null | undefined,
    loadCanvas: () => Promise<ChannelCanvasView>,
  ): Promise<RoomDoc> {
    const existing = this.rooms.get(conversationId);
    if (existing) return existing;

    const canvas = await loadCanvas();
    const doc = new Y.Doc();
    if (canvas.ydocState) {
      try {
        Y.applyUpdate(doc, fromBase64(canvas.ydocState));
      } catch {
        this.seedFromPlaintext(doc, canvas.title, canvas.body);
      }
    } else {
      this.seedFromPlaintext(doc, canvas.title, canvas.body);
    }

    const room: RoomDoc = {
      doc,
      conversationId,
      organizationId: organization?.id ?? (canvas.organizationId || null),
      dirty: !canvas.ydocState && Boolean(canvas.title || canvas.body),
      persistTimer: null,
      lastActorId: canvas.updatedBy || null,
      clients: new Set(),
    };
    this.rooms.set(conversationId, room);
    if (room.dirty) {
      this.schedulePersist(room, 500);
    }
    return room;
  }

  private seedFromPlaintext(doc: Y.Doc, title: string, body: string) {
    doc.transact(() => {
      const titleText = doc.getText('title');
      const bodyText = doc.getText('body');
      if (titleText.length === 0 && title) {
        titleText.insert(0, title);
      }
      if (bodyText.length === 0 && body) {
        bodyText.insert(0, body);
      }
    });
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
    const title = room.doc.getText('title').toString().slice(0, 160);
    const body = room.doc.getText('body').toString();
    const ydocState = toBase64(Y.encodeStateAsUpdate(room.doc));
    room.dirty = false;
    try {
      await this.proxy.sendChat(
        CHAT_PATTERNS.SAVE_CANVAS_YDOC,
        {
          actorId,
          conversationId: room.conversationId,
          ydocState,
          title,
          body,
          ...(room.organizationId
            ? { organizationId: room.organizationId }
            : {}),
        },
        { skipTenant: !room.organizationId },
      );
    } catch (error) {
      room.dirty = true;
      this.logger.warn(
        `Failed to persist canvas ${room.conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}
