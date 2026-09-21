import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { RpcErrors } from '@app/common';
import { requireOrganizationId } from '@app/database';
import {
  INTEGRATION_CATALOG_META,
  IntegrationsService,
} from './integrations.service';

const DEFAULT_STANDUP_QUESTIONS = [
  'What did you do yesterday?',
  'What will you do today?',
  'Any blockers?',
];
const DEFAULT_DSU_QUESTIONS = [
  'Yesterday’s progress?',
  'Today’s plan?',
  'Blockers or risks?',
];
const DEFAULT_MEETING_QUESTIONS = [
  'Ready for the meeting?',
  'Anything to add to the agenda?',
  'Any decisions needed today?',
];

const BOT_APP_KEYS = new Set(['standup', 'dsu', 'daily-meeting']);

const APP_CATALOG = [
  {
    key: 'standup',
    name: 'Standup Bot',
    description: 'Posts a daily standup prompt and collects team updates in-thread.',
    icon: 'standup',
    category: 'bot' as const,
    configurable: true,
  },
  {
    key: 'dsu',
    name: 'DSU Bot',
    description: 'Daily Stand-Up bot with blockers-focused prompts for engineering teams.',
    icon: 'dsu',
    category: 'bot' as const,
    configurable: true,
  },
  {
    key: 'daily-meeting',
    name: 'Daily Meeting Bot',
    description: 'Morning check-in bot for daily meeting readiness and agenda items.',
    icon: 'meeting',
    category: 'bot' as const,
    configurable: true,
  },
  { key: 'google-drive', name: 'Google Drive', description: 'Unfurl Drive files and docs in channels.', icon: 'drive', category: 'integration' as const },
  { key: 'github', name: 'GitHub', description: 'Unfurl repos/PRs, create issues from messages, receive events.', icon: 'github', category: 'integration' as const },
  { key: 'jira', name: 'Jira', description: 'Unfurl issues, create tasks from messages, receive project events.', icon: 'jira', category: 'integration' as const },
  { key: 'zoom', name: 'Zoom', description: 'Start Zoom meetings from a channel.', icon: 'video', category: 'integration' as const },
] as const;
const STATUSES = new Set(['todo', 'doing', 'done']);
const TRIGGERS = new Set(['message_contains', 'channel_created', 'manual']);
const ACTIONS = new Set(['post_message', 'webhook', 'set_reminder']);

@Injectable()
export class SlackProductsService {
  constructor(
    private readonly db: DataSource,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * TypeORM 1.x Postgres driver returns rows[] for SELECT/INSERT, but
   * [rows, rowCount] for UPDATE/DELETE. Normalize to rows[].
   */
  private unwrapRows<T = any>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === 'number'
    ) {
      return result[0] as T[];
    }
    return result as T[];
  }

  private async queryRows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.unwrapRows<T>(await this.db.query(sql, params));
  }

  private async queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.queryRows<T>(sql, params))[0];
  }

  private async requireMembership(conversationId: string, actorId: string) {
    const row = await this.queryOne(
      `SELECT c.* FROM conversations c JOIN conversation_members m ON m."conversationId"=c.id
       WHERE c.id=$1 AND c."organizationId"=$2 AND c."deletedAt" IS NULL
       AND m."userId"=$3 AND m."leftAt" IS NULL LIMIT 1`,
      [conversationId, requireOrganizationId(), actorId],
    );
    if (!row) return RpcErrors.forbidden('You are not a member of this conversation') as never;
    return row;
  }

  /** null = unassigned; undefined = leave unchanged (caller decides). */
  private async resolveAssigneeId(
    conversationId: string,
    assigneeId: unknown,
  ): Promise<string | null> {
    if (assigneeId === null || assigneeId === '') return null;
    const id = String(assigneeId ?? '').trim();
    if (!id) return null;
    const member = await this.queryOne(
      `SELECT "userId" FROM conversation_members
       WHERE "conversationId"=$1 AND "userId"=$2 AND "leftAt" IS NULL LIMIT 1`,
      [conversationId, id],
    );
    if (!member) {
      return RpcErrors.badRequest('Assignee must be a member of this channel') as never;
    }
    return id;
  }

  private text(value: unknown, name: string, max: number) {
    const text = String(value ?? '').trim();
    if (!text || text.length > max) return RpcErrors.badRequest(`${name} is required (max ${max} characters)`) as never;
    return text;
  }

  private toCanvasView(row: any | null, conversationId: string) {
    const organizationId = requireOrganizationId();
    if (!row) {
      return {
        id: '',
        organizationId,
        conversationId,
        title: '',
        body: '',
        updatedBy: '',
        createdAt: '',
        updatedAt: '',
      };
    }
    return {
      id: String(row.id),
      organizationId: String(row.organizationId ?? organizationId),
      conversationId: String(row.conversationId ?? conversationId),
      title: String(row.title ?? ''),
      body: String(row.body ?? ''),
      updatedBy: String(row.updatedBy ?? ''),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
    };
  }

  async getCanvas(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `SELECT * FROM channel_canvases WHERE "organizationId"=$1 AND "conversationId"=$2`,
      [requireOrganizationId(), p.conversationId],
    );
    return this.toCanvasView(row ?? null, p.conversationId);
  }

  async putCanvas(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `INSERT INTO channel_canvases ("organizationId","conversationId","title","body","updatedBy")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("organizationId","conversationId") DO UPDATE SET
       title=EXCLUDED.title, body=EXCLUDED.body, "updatedBy"=EXCLUDED."updatedBy", "updatedAt"=now()
       RETURNING *`,
      [requireOrganizationId(), p.conversationId, String(p.title ?? '').slice(0, 160), String(p.body ?? ''), p.actorId],
    );
    return this.toCanvasView(row, p.conversationId);
  }

  async listLists(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const lists = await this.queryRows(
      `SELECT * FROM channel_lists WHERE "organizationId"=$1 AND "conversationId"=$2 ORDER BY "createdAt"`,
      [requireOrganizationId(), p.conversationId],
    );
    if (!lists.length) return [];
    const items = await this.queryRows(
      `SELECT * FROM channel_list_items WHERE "listId"=ANY($1::uuid[]) ORDER BY "sortOrder","createdAt"`,
      [lists.map((list: any) => list.id)],
    );
    return lists.map((list: any) =>
      this.toListView(
        list,
        items.filter((item: any) => item.listId === list.id),
      ),
    );
  }

  private toListItemView(row: any) {
    return {
      id: String(row.id),
      listId: String(row.listId),
      title: String(row.title ?? ''),
      status: (row.status === 'doing' || row.status === 'done' ? row.status : 'todo') as
        | 'todo'
        | 'doing'
        | 'done',
      assigneeId: row.assigneeId ? String(row.assigneeId) : null,
      sortOrder: Number(row.sortOrder) || 0,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    };
  }

  private toListView(row: any, items: any[] = []) {
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      conversationId: String(row.conversationId),
      name: String(row.name ?? ''),
      createdBy: String(row.createdBy),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      items: items.map((item) => this.toListItemView(item)),
    };
  }

  async createList(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `INSERT INTO channel_lists ("organizationId","conversationId","name","createdBy") VALUES ($1,$2,$3,$4) RETURNING *`,
      [requireOrganizationId(), p.conversationId, this.text(p.name, 'name', 160), p.actorId],
    );
    return this.toListView(row, []);
  }

  private async requireList(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const list = await this.queryOne(
      `SELECT * FROM channel_lists WHERE id=$1 AND "conversationId"=$2 AND "organizationId"=$3`,
      [p.listId, p.conversationId, requireOrganizationId()],
    );
    if (!list) return RpcErrors.notFound('Channel list') as never;
    return list;
  }

  async getList(p: any) {
    const list = await this.requireList(p);
    const items = await this.queryRows(
      `SELECT * FROM channel_list_items WHERE "listId"=$1 ORDER BY "sortOrder","createdAt"`,
      [p.listId],
    );
    return this.toListView(list, items);
  }

  async updateList(p: any) {
    await this.requireList(p);
    const row = await this.queryOne(
      `UPDATE channel_lists SET name=$1 WHERE id=$2 RETURNING *`,
      [this.text(p.name, 'name', 160), p.listId],
    );
    if (!row) return RpcErrors.notFound('Channel list') as never;
    const items = await this.queryRows(
      `SELECT * FROM channel_list_items WHERE "listId"=$1 ORDER BY "sortOrder","createdAt"`,
      [p.listId],
    );
    return this.toListView(row, items);
  }

  async deleteList(p: any) {
    await this.requireList(p);
    await this.db.query(`DELETE FROM channel_lists WHERE id=$1`, [p.listId]);
    return { deleted: true };
  }

  async createListItem(p: any) {
    await this.requireList(p);
    const status = p.status ?? 'todo';
    if (!STATUSES.has(status)) return RpcErrors.badRequest('status must be todo, doing, or done');
    const assigneeId =
      p.assigneeId === undefined
        ? null
        : await this.resolveAssigneeId(p.conversationId, p.assigneeId);
    const row = await this.queryOne(
      `INSERT INTO channel_list_items ("listId","title","status","assigneeId","sortOrder") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [p.listId, this.text(p.title, 'title', 500), status, assigneeId, Number(p.sortOrder) || 0],
    );
    if (!row) return RpcErrors.internal('Could not create list item') as never;
    const item = this.toListItemView(row);
    const notification =
      assigneeId && assigneeId !== p.actorId
        ? await this.createListAssignmentNotification({
            actorId: p.actorId,
            conversationId: p.conversationId,
            listId: p.listId,
            item,
          })
        : null;
    return { item, notification };
  }

  async updateListItem(p: any) {
    await this.requireList(p);
    if (p.status !== undefined && !STATUSES.has(p.status)) {
      return RpcErrors.badRequest('status must be todo, doing, or done');
    }
    const previous = await this.queryOne(
      `SELECT * FROM channel_list_items WHERE id=$1 AND "listId"=$2`,
      [p.itemId, p.listId],
    );
    if (!previous) return RpcErrors.notFound('Channel list item');
    const previousAssignee = previous.assigneeId
      ? String(previous.assigneeId)
      : null;
    const assigneeId =
      p.assigneeId === undefined
        ? undefined
        : await this.resolveAssigneeId(p.conversationId, p.assigneeId);
    const row = await this.queryOne(
      `UPDATE channel_list_items SET title=COALESCE($1,title), status=COALESCE($2,status),
       "assigneeId"=CASE WHEN $3::boolean THEN $4::uuid ELSE "assigneeId" END,
       "sortOrder"=COALESCE($5,"sortOrder") WHERE id=$6 AND "listId"=$7 RETURNING *`,
      [
        p.title === undefined ? null : this.text(p.title, 'title', 500),
        p.status ?? null,
        p.assigneeId !== undefined,
        assigneeId ?? null,
        p.sortOrder ?? null,
        p.itemId,
        p.listId,
      ],
    );
    if (!row) return RpcErrors.notFound('Channel list item');
    const item = this.toListItemView(row);
    const nextAssignee = item.assigneeId;
    const assigneeChanged =
      p.assigneeId !== undefined && nextAssignee !== previousAssignee;
    const notification =
      assigneeChanged && nextAssignee && nextAssignee !== p.actorId
        ? await this.createListAssignmentNotification({
            actorId: p.actorId,
            conversationId: p.conversationId,
            listId: p.listId,
            item,
          })
        : null;
    return { item, notification };
  }

  private toUserNotificationView(row: any) {
    const readAt = row.readAt ? new Date(row.readAt).toISOString() : null;
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      userId: String(row.userId),
      actorId: String(row.actorId),
      type: String(row.type ?? 'list_assignment'),
      title: String(row.title ?? ''),
      body: String(row.body ?? ''),
      conversationId: row.conversationId ? String(row.conversationId) : null,
      listId: row.listId ? String(row.listId) : null,
      listItemId: row.listItemId ? String(row.listItemId) : null,
      meta:
        row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : {},
      readAt,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      unread: !readAt,
    };
  }

  private async createListAssignmentNotification(input: {
    actorId: string;
    conversationId: string;
    listId: string;
    item: {
      id: string;
      title: string;
      assigneeId: string | null;
    };
  }) {
    if (!input.item.assigneeId) return null;
    const context = await this.queryOne(
      `SELECT l.name AS "listName", c.name AS "channelName", c.type AS "channelType"
       FROM channel_lists l
       JOIN conversations c ON c.id = l."conversationId"
       WHERE l.id=$1 AND l."conversationId"=$2
       LIMIT 1`,
      [input.listId, input.conversationId],
    );
    const listName = String(context?.listName ?? 'List').trim() || 'List';
    const channelRaw = String(context?.channelName ?? '').trim();
    const channelLabel =
      context?.channelType === 'group'
        ? `#${channelRaw.replace(/^#/, '') || 'channel'}`
        : channelRaw || 'Direct message';
    const title = 'Task assigned to you';
    const body = `"${input.item.title}" in ${listName} · ${channelLabel}`.slice(
      0,
      500,
    );
    const row = await this.queryOne(
      `INSERT INTO user_notifications (
         "organizationId","userId","actorId","type","title","body",
         "conversationId","listId","listItemId","meta"
       ) VALUES ($1,$2,$3,'list_assignment',$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        requireOrganizationId(),
        input.item.assigneeId,
        input.actorId,
        title,
        body,
        input.conversationId,
        input.listId,
        input.item.id,
        JSON.stringify({
          listName,
          channelName: channelRaw || null,
          channelType: context?.channelType ?? null,
          itemTitle: input.item.title,
        }),
      ],
    );
    if (!row) return null;
    return this.toUserNotificationView(row);
  }

  async listUserNotifications(p: any) {
    const page = Math.max(1, Number(p.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(p.limit) || 40));
    const offset = (page - 1) * limit;
    const unreadOnly = Boolean(p.unreadOnly);
    const organizationId = requireOrganizationId();
    const where = unreadOnly
      ? `WHERE "organizationId"=$1 AND "userId"=$2 AND "readAt" IS NULL`
      : `WHERE "organizationId"=$1 AND "userId"=$2`;
    const countRow = await this.queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM user_notifications ${where}`,
      [organizationId, p.actorId],
    );
    const total = Number(countRow?.total ?? 0) || 0;
    const rows = await this.queryRows(
      `SELECT * FROM user_notifications ${where}
       ORDER BY "createdAt" DESC
       LIMIT $3 OFFSET $4`,
      [organizationId, p.actorId, limit, offset],
    );
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    return {
      items: rows.map((row) => this.toUserNotificationView(row)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async markUserNotificationRead(p: any) {
    const row = await this.queryOne(
      `UPDATE user_notifications
       SET "readAt"=COALESCE("readAt", now())
       WHERE id=$1 AND "userId"=$2 AND "organizationId"=$3
       RETURNING *`,
      [p.notificationId, p.actorId, requireOrganizationId()],
    );
    if (!row) return RpcErrors.notFound('Notification');
    return this.toUserNotificationView(row);
  }

  async markAllUserNotificationsRead(p: any) {
    const rows = await this.queryRows(
      `UPDATE user_notifications
       SET "readAt"=now()
       WHERE "userId"=$1 AND "organizationId"=$2 AND "readAt" IS NULL
       RETURNING id`,
      [p.actorId, requireOrganizationId()],
    );
    return { updated: rows.length };
  }

  async countUnreadUserNotifications(p: any) {
    const row = await this.queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM user_notifications
       WHERE "organizationId"=$1 AND "userId"=$2 AND "readAt" IS NULL`,
      [requireOrganizationId(), p.actorId],
    );
    return { count: Number(row?.total ?? 0) || 0 };
  }

  async deleteListItem(p: any) {
    await this.requireList(p);
    const result = await this.queryRows(
      `DELETE FROM channel_list_items WHERE id=$1 AND "listId"=$2 RETURNING id`,
      [p.itemId, p.listId],
    );
    if (!result.length) return RpcErrors.notFound('Channel list item');
    return { deleted: true };
  }

  async listClips(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const rows = await this.queryRows(
      `SELECT * FROM channel_clips WHERE "organizationId"=$1 AND "conversationId"=$2 ORDER BY "createdAt" DESC`,
      [requireOrganizationId(), p.conversationId],
    );
    return rows.map((row: any) => this.toClipView(row));
  }

  private toClipView(row: any) {
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      conversationId: String(row.conversationId),
      messageId: row.messageId ? String(row.messageId) : null,
      createdBy: String(row.createdBy),
      mediaUrl: String(row.mediaUrl ?? ''),
      mediaType: row.mediaType === 'video' ? ('video' as const) : ('audio' as const),
      durationSeconds:
        row.durationSeconds === null || row.durationSeconds === undefined
          ? null
          : Number(row.durationSeconds),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    };
  }

  async createClip(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    if (!['audio', 'video'].includes(p.mediaType)) {
      return RpcErrors.badRequest('mediaType must be audio or video');
    }
    const mediaUrl = this.text(p.mediaUrl, 'mediaUrl', 1000);
    let durationSeconds =
      p.durationSeconds === undefined || p.durationSeconds === null
        ? null
        : Math.round(Number(p.durationSeconds));
    if (durationSeconds !== null) {
      if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
        return RpcErrors.badRequest('durationSeconds must be at least 1') as never;
      }
      durationSeconds = Math.min(durationSeconds, 180);
    }
    const row = await this.queryOne(
      `INSERT INTO channel_clips ("organizationId","conversationId","messageId","createdBy","mediaUrl","mediaType","durationSeconds")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        requireOrganizationId(),
        p.conversationId,
        p.messageId ?? null,
        p.actorId,
        mediaUrl,
        p.mediaType,
        durationSeconds,
      ],
    );
    return this.toClipView(row);
  }

  async deleteClip(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `SELECT * FROM channel_clips WHERE id=$1 AND "organizationId"=$2 AND "conversationId"=$3`,
      [p.clipId, requireOrganizationId(), p.conversationId],
    );
    if (!row) return RpcErrors.notFound('Clip') as never;
    if (String(row.createdBy) !== String(p.actorId)) {
      return RpcErrors.forbidden('Only the clip creator can delete it') as never;
    }
    await this.db.query(`DELETE FROM channel_clips WHERE id=$1`, [p.clipId]);
    return { deleted: true, mediaUrl: String(row.mediaUrl ?? '') };
  }

  async getHuddle(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `SELECT * FROM channel_huddles WHERE "organizationId"=$1 AND "conversationId"=$2 AND status='active' ORDER BY "startedAt" DESC LIMIT 1`,
      [requireOrganizationId(), p.conversationId],
    );
    return row ?? null;
  }
  async startHuddle(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const active = await this.getHuddle(p);
    if (active) return active;
    const row = await this.queryOne(
      `INSERT INTO channel_huddles ("organizationId","conversationId","startedBy","participantIds") VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
      [requireOrganizationId(), p.conversationId, p.actorId, JSON.stringify([p.actorId])],
    );
    return row;
  }
  async joinHuddle(p: any) {
    const huddle = await this.getHuddle(p);
    if (!huddle) return RpcErrors.notFound('Active huddle');
    const ids = Array.from(new Set([...(huddle.participantIds ?? []), p.actorId]));
    const row = await this.queryOne(`UPDATE channel_huddles SET "participantIds"=$1::jsonb WHERE id=$2 RETURNING *`, [JSON.stringify(ids), huddle.id]);
    return row;
  }
  async leaveHuddle(p: any) {
    const huddle = await this.getHuddle(p);
    if (!huddle) return RpcErrors.notFound('Active huddle');
    const ids = (huddle.participantIds ?? []).filter((id: string) => id !== p.actorId);
    const row = await this.queryOne(`UPDATE channel_huddles SET "participantIds"=$1::jsonb WHERE id=$2 RETURNING *`, [JSON.stringify(ids), huddle.id]);
    return row;
  }
  async endHuddle(p: any) {
    const huddle = await this.getHuddle(p);
    if (!huddle) return RpcErrors.notFound('Active huddle');
    if (huddle.startedBy !== p.actorId) return RpcErrors.forbidden('Only the huddle starter can end it');
    const row = await this.queryOne(`UPDATE channel_huddles SET status='ended',"endedAt"=now(),"participantIds"='[]'::jsonb WHERE id=$1 RETURNING *`, [huddle.id]);
    return row;
  }

  private parseJson(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
    return {};
  }

  private toWorkflowView(row: any) {
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      conversationId: row.conversationId ? String(row.conversationId) : null,
      name: String(row.name ?? ''),
      enabled: Boolean(row.enabled),
      triggerType: row.triggerType as 'message_contains' | 'channel_created' | 'manual',
      triggerConfig: this.parseJson(row.triggerConfig),
      actionType: row.actionType as 'post_message' | 'webhook' | 'set_reminder',
      actionConfig: this.parseJson(row.actionConfig),
      createdBy: String(row.createdBy),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    };
  }

  private validateWorkflowShape(p: {
    triggerType?: string;
    actionType?: string;
    triggerConfig?: Record<string, unknown>;
    actionConfig?: Record<string, unknown>;
  }) {
    if (!TRIGGERS.has(String(p.triggerType)) || !ACTIONS.has(String(p.actionType))) {
      return RpcErrors.badRequest('Invalid workflow trigger or action type') as never;
    }
    if (p.triggerType === 'message_contains') {
      const contains = String(p.triggerConfig?.contains ?? '').trim();
      if (!contains || contains.length > 200) {
        return RpcErrors.badRequest('Trigger keyword is required (max 200 characters)') as never;
      }
    }
    if (p.actionType === 'post_message') {
      const body = String(p.actionConfig?.body ?? '').trim();
      if (!body || body.length > 4000) {
        return RpcErrors.badRequest('Action message body is required (max 4000 characters)') as never;
      }
    }
    if (p.actionType === 'webhook') {
      const url = String(p.actionConfig?.url ?? '').trim();
      if (!/^https:\/\//i.test(url) || url.length > 1000) {
        return RpcErrors.badRequest('Action webhook must be an https URL') as never;
      }
    }
    if (p.actionType === 'set_reminder') {
      const delay = Number(p.actionConfig?.delayMinutes ?? 60);
      if (!Number.isFinite(delay) || delay < 1 || delay > 60 * 24 * 30) {
        return RpcErrors.badRequest('Reminder delay must be between 1 minute and 30 days') as never;
      }
    }
  }

  async listWorkflows(p: any) {
    if (p.conversationId) await this.requireMembership(p.conversationId, p.actorId);
    const rows = await this.queryRows(
      `SELECT * FROM channel_workflows WHERE "organizationId"=$1 AND ($2::uuid IS NULL OR "conversationId"=$2) ORDER BY "createdAt" DESC`,
      [requireOrganizationId(), p.conversationId ?? null],
    );
    return rows.map((row: any) => this.toWorkflowView(row));
  }

  async createWorkflow(p: any) {
    if (p.conversationId) await this.requireMembership(p.conversationId, p.actorId);
    const triggerConfig = this.parseJson(p.triggerConfig);
    const actionConfig = this.parseJson(p.actionConfig);
    this.validateWorkflowShape({
      triggerType: p.triggerType,
      actionType: p.actionType,
      triggerConfig,
      actionConfig,
    });
    const row = await this.queryOne(
      `INSERT INTO channel_workflows ("organizationId","conversationId","name","enabled","triggerType","triggerConfig","actionType","actionConfig","createdBy")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9) RETURNING *`,
      [
        requireOrganizationId(),
        p.conversationId ?? null,
        this.text(p.name, 'name', 160),
        p.enabled !== false,
        p.triggerType,
        JSON.stringify(triggerConfig),
        p.actionType,
        JSON.stringify(actionConfig),
        p.actorId,
      ],
    );
    return this.toWorkflowView(row);
  }

  private async requireWorkflow(p: any) {
    if (p.conversationId) await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `SELECT * FROM channel_workflows WHERE id=$1 AND "organizationId"=$2`,
      [p.workflowId, requireOrganizationId()],
    );
    if (!row) return RpcErrors.notFound('Workflow') as never;
    if (row.conversationId) await this.requireMembership(row.conversationId, p.actorId);
    return row;
  }

  async updateWorkflow(p: any) {
    const old = await this.requireWorkflow(p);
    const next = {
      name: p.name !== undefined ? p.name : old.name,
      enabled: p.enabled !== undefined ? Boolean(p.enabled) : Boolean(old.enabled),
      triggerType: p.triggerType ?? old.triggerType,
      triggerConfig:
        p.triggerConfig !== undefined
          ? this.parseJson(p.triggerConfig)
          : this.parseJson(old.triggerConfig),
      actionType: p.actionType ?? old.actionType,
      actionConfig:
        p.actionConfig !== undefined
          ? this.parseJson(p.actionConfig)
          : this.parseJson(old.actionConfig),
    };
    this.validateWorkflowShape(next);
    const row = await this.queryOne(
      `UPDATE channel_workflows SET name=$1,enabled=$2,"triggerType"=$3,"triggerConfig"=$4::jsonb,
       "actionType"=$5,"actionConfig"=$6::jsonb WHERE id=$7 RETURNING *`,
      [
        this.text(next.name, 'name', 160),
        next.enabled,
        next.triggerType,
        JSON.stringify(next.triggerConfig),
        next.actionType,
        JSON.stringify(next.actionConfig),
        p.workflowId,
      ],
    );
    return this.toWorkflowView(row);
  }

  async deleteWorkflow(p: any) {
    await this.requireWorkflow(p);
    await this.db.query(`DELETE FROM channel_workflows WHERE id=$1`, [p.workflowId]);
    return { deleted: true };
  }

  async runWorkflow(p: any) {
    const row = await this.requireWorkflow(p);
    const workflow = this.toWorkflowView(row);
    if (!workflow.enabled) {
      return RpcErrors.badRequest('Workflow is paused') as never;
    }
    const conversationId = workflow.conversationId || p.conversationId;
    if (!conversationId) {
      return RpcErrors.badRequest('Workflow is not attached to a channel') as never;
    }
    const messages = await this.executeWorkflow(workflow, {
      actorId: p.actorId,
      conversationId,
      message: null,
      manual: true,
    });
    return { workflow, messages };
  }

  async evaluateWorkflows(p: any) {
    if (!p.conversationId) return { messages: [] };
    if (p.message?.botUsername) return { messages: [] };

    const rows = await this.queryRows(
      `SELECT * FROM channel_workflows
       WHERE "organizationId"=$1 AND enabled=true AND "triggerType"=$2
         AND ("conversationId" IS NULL OR "conversationId"=$3)
       ORDER BY "createdAt" ASC`,
      [requireOrganizationId(), p.triggerType, p.conversationId],
    );

    const messages: Array<Record<string, unknown> & { conversationId: string; recipientIds?: string[] }> = [];
    for (const row of rows) {
      const workflow = this.toWorkflowView(row);
      if (p.triggerType === 'message_contains') {
        const needle = String(workflow.triggerConfig.contains ?? '')
          .trim()
          .toLowerCase();
        const haystack = String(p.message?.body ?? '').toLowerCase();
        if (!needle || !haystack.includes(needle)) continue;
      }
      try {
        const produced = await this.executeWorkflow(workflow, {
          actorId: p.actorId,
          conversationId: p.conversationId,
          message: p.message ?? null,
          manual: false,
        });
        messages.push(...produced);
      } catch (error) {
        console.warn('[workflows] execute failed:', (error as Error)?.message ?? error);
      }
    }
    return { messages };
  }

  private async executeWorkflow(
    workflow: ReturnType<SlackProductsService['toWorkflowView']>,
    context: {
      actorId: string;
      conversationId: string;
      message: { id: string; body: string; senderId: string } | null;
      manual: boolean;
    },
  ) {
    const messages: Array<Record<string, unknown> & { conversationId: string; recipientIds?: string[] }> = [];
    if (workflow.actionType === 'post_message') {
      const body = String(workflow.actionConfig.body ?? '').trim();
      if (!body) return messages;
      const posted = await this.postWorkflowMessage(
        context.conversationId,
        body,
        workflow.createdBy || context.actorId,
        workflow.name,
      );
      if (posted) messages.push(posted);
      return messages;
    }
    if (workflow.actionType === 'webhook') {
      const url = String(workflow.actionConfig.url ?? '').trim();
      if (!url) return messages;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            event: context.manual ? 'workflow.manual' : `workflow.${workflow.triggerType}`,
            workflow: {
              id: workflow.id,
              name: workflow.name,
              conversationId: context.conversationId,
            },
            message: context.message,
            actorId: context.actorId,
            triggeredAt: new Date().toISOString(),
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      return messages;
    }
    if (workflow.actionType === 'set_reminder') {
      if (!context.message?.id) return messages;
      const delayMinutes = Math.max(
        1,
        Math.min(60 * 24 * 30, Number(workflow.actionConfig.delayMinutes ?? 60) || 60),
      );
      const remindAt = new Date(Date.now() + delayMinutes * 60_000);
      await this.db.query(
        `INSERT INTO message_reminders (
           "organizationId","userId","conversationId","messageId","remindAt",status
         ) VALUES ($1,$2,$3,$4,$5,'pending')`,
        [
          requireOrganizationId(),
          workflow.createdBy || context.actorId,
          context.conversationId,
          context.message.id,
          remindAt.toISOString(),
        ],
      );
    }
    return messages;
  }

  private async postWorkflowMessage(
    conversationId: string,
    body: string,
    senderId: string,
    workflowName: string,
  ) {
    const conversation = await this.queryOne(
      `SELECT id FROM conversations
       WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL LIMIT 1`,
      [conversationId, requireOrganizationId()],
    );
    if (!conversation) return null;

    const saved = await this.queryOne(
      `INSERT INTO messages (
         "organizationId","conversationId","senderId",body,type,
         "replyToMessageId","attachmentUrl","attachmentMime","attachmentName","attachmentSize",
         mentions,"linkPreview",poll,"botUsername","botIconUrl"
       ) VALUES (
         $1,$2,$3,$4,'text',
         NULL,NULL,NULL,NULL,NULL,
         '[]'::jsonb,NULL,NULL,$5,NULL
       ) RETURNING *`,
      [
        requireOrganizationId(),
        conversationId,
        senderId,
        body.slice(0, 4000),
        `Workflow: ${workflowName}`.slice(0, 80),
      ],
    );
    await this.db.query(
      `UPDATE conversations SET "lastMessageAt"=$1, "updatedAt"=now() WHERE id=$2`,
      [saved.createdAt, conversationId],
    );
    const members = await this.queryRows(
      `SELECT "userId" FROM conversation_members
       WHERE "conversationId"=$1 AND "leftAt" IS NULL`,
      [conversationId],
    );
    const recipientIds = members.map((member: { userId: string }) => String(member.userId));
    const createdAt = new Date(saved.createdAt).toISOString();
    return {
      id: String(saved.id),
      conversationId,
      senderId: String(saved.senderId),
      body: String(saved.body),
      type: 'text',
      replyToMessageId: null,
      threadRootId: null,
      attachmentUrl: null,
      attachmentMime: null,
      attachmentName: null,
      attachmentSize: null,
      mentions: [],
      reactions: [],
      linkPreview: null,
      poll: null,
      pinned: false,
      editedAt: null,
      deletedForEveryone: false,
      botUsername: saved.botUsername ?? `Workflow: ${workflowName}`,
      botIconUrl: null,
      createdAt,
      updatedAt: createdAt,
      recipientIds,
    };
  }

  private toSharedInviteView(row: any, inviteUrl?: string | null) {
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      conversationId: String(row.conversationId),
      email: String(row.email ?? ''),
      token: row.token ? String(row.token) : undefined,
      status: (row.status || 'pending') as 'pending' | 'accepted' | 'revoked',
      inviteKind: (row.inviteKind === 'workspace_share'
        ? 'workspace_share'
        : 'guest_email') as 'guest_email' | 'workspace_share',
      createdBy: String(row.createdBy),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      acceptedAt: row.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
      inviteUrl: inviteUrl ?? null,
      partnerOrganizationName: row.partnerOrganizationName
        ? String(row.partnerOrganizationName)
        : null,
    };
  }

  private toSharedLinkView(row: any) {
    return {
      id: String(row.id),
      hostOrganizationId: String(row.hostOrganizationId),
      hostConversationId: String(row.hostConversationId),
      partnerOrganizationId: String(row.partnerOrganizationId),
      partnerConversationId: String(row.partnerConversationId),
      partnerOrganizationName: row.partnerOrganizationName
        ? String(row.partnerOrganizationName)
        : null,
      hostOrganizationName: row.hostOrganizationName
        ? String(row.hostOrganizationName)
        : null,
      status: (row.status || 'active') as 'pending' | 'active' | 'disconnected',
      createdBy: String(row.createdBy),
      acceptedBy: row.acceptedBy ? String(row.acceptedBy) : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      disconnectedAt: row.disconnectedAt
        ? new Date(row.disconnectedAt).toISOString()
        : null,
    };
  }

  async createSharedInvite(p: any) {
    const conversation = await this.requireMembership(p.conversationId, p.actorId);
    if (conversation.type && conversation.type !== 'group') {
      return RpcErrors.badRequest('Connect is only available on channels') as never;
    }
    const email = String(p.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return RpcErrors.badRequest('A valid email is required');
    }
    const mode =
      p.mode === 'workspace' || p.inviteKind === 'workspace_share'
        ? 'workspace_share'
        : 'guest_email';
    const existing = await this.queryRows(
      `SELECT id FROM shared_channel_invites
       WHERE "organizationId"=$1 AND "conversationId"=$2 AND lower(email)=lower($3)
         AND status='pending' AND COALESCE("inviteKind",'guest_email')=$4
       LIMIT 1`,
      [requireOrganizationId(), p.conversationId, email, mode],
    );
    if (existing[0]) {
      return RpcErrors.badRequest('A pending Connect invite already exists for that email') as never;
    }
    const token = randomBytes(32).toString('hex');
    const row = await this.queryOne(
      `INSERT INTO shared_channel_invites (
         "organizationId","conversationId",email,token,"createdBy","inviteKind"
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [requireOrganizationId(), p.conversationId, email, token, p.actorId, mode],
    );
    return this.toSharedInviteView(
      row,
      mode === 'workspace_share' ? `/connect-invite/${token}` : undefined,
    );
  }

  async getSharedInfo(p: any) {
    const orgId = requireOrganizationId();
    const conversation = await this.requireMembership(p.conversationId, p.actorId);

    // Partner stub: show link from partner side
    const asPartner = await this.queryOne(
      `SELECT * FROM shared_channel_links
       WHERE "partnerConversationId"=$1 AND "partnerOrganizationId"=$2 AND status='active'
       LIMIT 1`,
      [p.conversationId, orgId],
    );
    if (asPartner) {
      return {
        conversationId: p.conversationId,
        isShared: true,
        sharedExternalLabel:
          asPartner.hostOrganizationName || conversation.sharedExternalLabel || null,
        conversationName: conversation.name ?? null,
        invites: [],
        links: [this.toSharedLinkView(asPartner)],
        connectRole: 'partner' as const,
        hostConversationId: String(asPartner.hostConversationId),
      };
    }

    const invites = await this.queryRows(
      `SELECT * FROM shared_channel_invites
       WHERE "organizationId"=$1 AND "conversationId"=$2
       ORDER BY "createdAt" DESC`,
      [orgId, p.conversationId],
    );
    const links = await this.queryRows(
      `SELECT * FROM shared_channel_links
       WHERE "hostConversationId"=$1 AND "hostOrganizationId"=$2 AND status='active'
       ORDER BY "createdAt" DESC`,
      [p.conversationId, orgId],
    );
    return {
      conversationId: p.conversationId,
      isShared: Boolean(conversation.isShared) || links.length > 0,
      sharedExternalLabel: conversation.sharedExternalLabel ?? null,
      conversationName: conversation.name ?? null,
      invites: invites.map((row: any) =>
        this.toSharedInviteView(
          row,
          row.status === 'pending' && row.token
            ? `/connect-invite/${row.token}`
            : null,
        ),
      ),
      links: links.map((row: any) => this.toSharedLinkView(row)),
      connectRole: 'host' as const,
      hostConversationId: p.conversationId,
    };
  }

  async previewSharedInvite(p: any) {
    const token = String(p.token ?? '').trim();
    if (!token) {
      return {
        valid: false,
        message: 'Invite token is missing',
        email: null,
        conversationId: null,
        conversationName: null,
        organizationId: null,
        organizationName: null,
      };
    }
    const invite = await this.queryOne(
      `SELECT * FROM shared_channel_invites WHERE token=$1 LIMIT 1`,
      [token],
    );
    if (!invite) {
      return {
        valid: false,
        message: 'This Connect invite was not found',
        email: null,
        conversationId: null,
        conversationName: null,
        organizationId: null,
        organizationName: null,
      };
    }
    if (invite.status !== 'pending') {
      return {
        valid: false,
        message:
          invite.status === 'accepted'
            ? 'This Connect invite was already accepted'
            : 'This Connect invite is no longer valid',
        email: invite.email,
        conversationId: invite.conversationId,
        conversationName: null,
        organizationId: invite.organizationId,
        organizationName: null,
        status: invite.status,
      };
    }
    const conversation = await this.queryOne(
      `SELECT id, name, "organizationId" FROM conversations WHERE id=$1 AND "deletedAt" IS NULL LIMIT 1`,
      [invite.conversationId],
    );
    return {
      valid: true,
      email: invite.email,
      conversationId: invite.conversationId,
      conversationName: conversation?.name ?? null,
      organizationId: invite.organizationId,
      organizationName: null,
      status: invite.status,
      inviteKind:
        invite.inviteKind === 'workspace_share'
          ? 'workspace_share'
          : 'guest_email',
    };
  }

  async acceptSharedInvite(p: any) {
    const token = String(p.token ?? '').trim();
    const invite = await this.queryOne(
      `SELECT * FROM shared_channel_invites WHERE token=$1 AND status='pending' LIMIT 1`,
      [token],
    );
    if (!invite) return RpcErrors.notFound('Shared channel invite') as never;
    if (invite.inviteKind === 'workspace_share') {
      return RpcErrors.badRequest(
        'This is a workspace share invite — use workspace accept',
      ) as never;
    }

    const row = await this.queryOne(
      `UPDATE shared_channel_invites SET status='accepted',"acceptedAt"=now() WHERE id=$1 RETURNING *`,
      [invite.id],
    );
    await this.db.query(
      `UPDATE conversations SET "isShared"=true,"sharedExternalLabel"=COALESCE("sharedExternalLabel",$1)
       WHERE id=$2 AND "organizationId"=$3`,
      [invite.email, invite.conversationId, invite.organizationId],
    );
    return this.toSharedInviteView(row);
  }

  async acceptWorkspaceShare(p: any) {
    const token = String(p.token ?? '').trim();
    const partnerOrganizationId = String(p.partnerOrganizationId ?? '').trim();
    const partnerOrganizationName = String(p.partnerOrganizationName ?? '').trim() || null;
    const hostOrganizationName = String(p.hostOrganizationName ?? '').trim() || null;
    if (!partnerOrganizationId) {
      return RpcErrors.badRequest('partnerOrganizationId is required') as never;
    }

    const invite = await this.queryOne(
      `SELECT * FROM shared_channel_invites WHERE token=$1 AND status='pending' LIMIT 1`,
      [token],
    );
    if (!invite) return RpcErrors.notFound('Connect invite') as never;
    if (invite.inviteKind !== 'workspace_share') {
      return RpcErrors.badRequest('Not a workspace share invite') as never;
    }
    if (String(invite.organizationId) === partnerOrganizationId) {
      return RpcErrors.badRequest(
        'Accept from your other workspace — not the host organization',
      ) as never;
    }

    const hostConversation = await this.queryOne(
      `SELECT * FROM conversations WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL LIMIT 1`,
      [invite.conversationId, invite.organizationId],
    );
    if (!hostConversation || hostConversation.type !== 'group') {
      return RpcErrors.notFound('Host channel') as never;
    }

    const existingLink = await this.queryOne(
      `SELECT * FROM shared_channel_links
       WHERE "hostConversationId"=$1 AND "partnerOrganizationId"=$2
       LIMIT 1`,
      [invite.conversationId, partnerOrganizationId],
    );
    if (existingLink && existingLink.status === 'active') {
      return {
        organizationId: partnerOrganizationId,
        conversationId: String(existingLink.partnerConversationId),
        hostConversationId: String(existingLink.hostConversationId),
        link: this.toSharedLinkView(existingLink),
        alreadyConnected: true,
      };
    }

    // Partner stub channel in the partner org (local sidebar entry).
    const stub = await this.queryOne(
      `INSERT INTO conversations (
         "organizationId", type, name, "createdBy", visibility, "announceOnly",
         "isShared", "sharedExternalLabel"
       ) VALUES ($1,'group',$2,$3,'private',false,true,$4)
       RETURNING *`,
      [
        partnerOrganizationId,
        hostConversation.name || 'Shared channel',
        p.actorId,
        hostOrganizationName || 'Connected workspace',
      ],
    );
    if (!stub) return RpcErrors.internal('Could not create partner channel') as never;

    await this.db.query(
      `INSERT INTO conversation_members (
         "conversationId","userId",role,"homeOrganizationId","membershipSource"
       ) VALUES ($1,$2,'owner',$3,'native')`,
      [stub.id, p.actorId, partnerOrganizationId],
    );

    // Add partner user onto the host conversation so messages are shared.
    const hostMember = await this.queryOne(
      `SELECT id, "leftAt" FROM conversation_members
       WHERE "conversationId"=$1 AND "userId"=$2 LIMIT 1`,
      [invite.conversationId, p.actorId],
    );
    if (hostMember?.leftAt) {
      await this.db.query(
        `UPDATE conversation_members
         SET "leftAt"=NULL, "homeOrganizationId"=$1, "membershipSource"='connect_partner'
         WHERE id=$2`,
        [partnerOrganizationId, hostMember.id],
      );
    } else if (!hostMember) {
      await this.db.query(
        `INSERT INTO conversation_members (
           "conversationId","userId",role,"homeOrganizationId","membershipSource"
         ) VALUES ($1,$2,'member',$3,'connect_partner')`,
        [invite.conversationId, p.actorId, partnerOrganizationId],
      );
    }

    let link: any;
    if (existingLink) {
      link = await this.queryOne(
        `UPDATE shared_channel_links SET
           status='active',
           "partnerConversationId"=$1,
           "partnerOrganizationName"=$2,
           "hostOrganizationName"=COALESCE($3,"hostOrganizationName"),
           "acceptedBy"=$4,
           "inviteId"=$5,
           "disconnectedAt"=NULL
         WHERE id=$6 RETURNING *`,
        [
          stub.id,
          partnerOrganizationName,
          hostOrganizationName,
          p.actorId,
          invite.id,
          existingLink.id,
        ],
      );
    } else {
      link = await this.queryOne(
        `INSERT INTO shared_channel_links (
           "hostOrganizationId","hostConversationId","partnerOrganizationId","partnerConversationId",
           "partnerOrganizationName","hostOrganizationName",status,"createdBy","acceptedBy","inviteId"
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9) RETURNING *`,
        [
          invite.organizationId,
          invite.conversationId,
          partnerOrganizationId,
          stub.id,
          partnerOrganizationName,
          hostOrganizationName,
          invite.createdBy,
          p.actorId,
          invite.id,
        ],
      );
    }

    await this.db.query(
      `UPDATE shared_channel_invites SET
         status='accepted', "acceptedAt"=now(), "acceptedByUserId"=$1,
         "partnerOrganizationId"=$2, "partnerConversationId"=$3,
         "partnerOrganizationName"=$4
       WHERE id=$5`,
      [
        p.actorId,
        partnerOrganizationId,
        stub.id,
        partnerOrganizationName,
        invite.id,
      ],
    );
    await this.db.query(
      `UPDATE conversations SET "isShared"=true,
         "sharedExternalLabel"=COALESCE($1,"sharedExternalLabel")
       WHERE id=$2 AND "organizationId"=$3`,
      [
        partnerOrganizationName || invite.email,
        invite.conversationId,
        invite.organizationId,
      ],
    );

    return {
      organizationId: partnerOrganizationId,
      conversationId: String(stub.id),
      hostConversationId: String(invite.conversationId),
      link: this.toSharedLinkView(link),
      alreadyConnected: false,
    };
  }

  async disconnectSharedChannel(p: any) {
    const orgId = requireOrganizationId();
    await this.requireMembership(p.conversationId, p.actorId);
    const link = await this.queryOne(
      `SELECT * FROM shared_channel_links WHERE id=$1 LIMIT 1`,
      [p.linkId],
    );
    if (!link || link.status !== 'active') {
      return RpcErrors.notFound('Shared channel link') as never;
    }
    const isHost =
      String(link.hostOrganizationId) === orgId &&
      String(link.hostConversationId) === String(p.conversationId);
    const isPartner =
      String(link.partnerOrganizationId) === orgId &&
      String(link.partnerConversationId) === String(p.conversationId);
    if (!isHost && !isPartner) {
      return RpcErrors.forbidden('Not allowed to disconnect this link') as never;
    }

    await this.db.query(
      `UPDATE shared_channel_links SET status='disconnected', "disconnectedAt"=now() WHERE id=$1`,
      [link.id],
    );
    // Soft-leave partner members from host channel that were connect_partner.
    await this.db.query(
      `UPDATE conversation_members SET "leftAt"=now()
       WHERE "conversationId"=$1 AND "membershipSource"='connect_partner'
         AND "homeOrganizationId"=$2 AND "leftAt" IS NULL`,
      [link.hostConversationId, link.partnerOrganizationId],
    );
    await this.db.query(
      `UPDATE conversations SET "deletedAt"=now()
       WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL`,
      [link.partnerConversationId, link.partnerOrganizationId],
    );

    const remaining = await this.queryOne(
      `SELECT id FROM shared_channel_links
       WHERE "hostConversationId"=$1 AND status='active' LIMIT 1`,
      [link.hostConversationId],
    );
    const guestLeft = await this.queryOne(
      `SELECT id FROM shared_channel_invites
       WHERE "conversationId"=$1 AND status='accepted' LIMIT 1`,
      [link.hostConversationId],
    );
    if (!remaining && !guestLeft) {
      await this.db.query(
        `UPDATE conversations SET "isShared"=false WHERE id=$1`,
        [link.hostConversationId],
      );
    }

    return { disconnected: true, linkId: String(link.id) };
  }

  async resolveConnectConversation(p: any) {
    const orgId = requireOrganizationId();
    const conversationId = String(p.conversationId ?? '');
    const asPartner = await this.queryOne(
      `SELECT * FROM shared_channel_links
       WHERE "partnerConversationId"=$1 AND "partnerOrganizationId"=$2 AND status='active'
       LIMIT 1`,
      [conversationId, orgId],
    );
    if (asPartner) {
      return {
        displayConversationId: conversationId,
        effectiveConversationId: String(asPartner.hostConversationId),
        effectiveOrganizationId: String(asPartner.hostOrganizationId),
        isPartnerStub: true,
        linkId: String(asPartner.id),
      };
    }
    return {
      displayConversationId: conversationId,
      effectiveConversationId: conversationId,
      effectiveOrganizationId: orgId,
      isPartnerStub: false,
      linkId: null,
    };
  }

  /** Partner-stub rooms that should receive a remapped copy of host-channel events. */
  async listConnectFanouts(hostConversationId: string) {
    const links = await this.queryRows(
      `SELECT id, "partnerConversationId", "partnerOrganizationId"
       FROM shared_channel_links
       WHERE "hostConversationId"=$1 AND status='active'`,
      [hostConversationId],
    );
    const fanouts: Array<{ conversationId: string; recipientIds: string[] }> = [];
    for (const link of links) {
      const members = await this.queryRows(
        `SELECT "userId" FROM conversation_members
         WHERE "conversationId"=$1 AND "leftAt" IS NULL`,
        [link.partnerConversationId],
      );
      fanouts.push({
        conversationId: String(link.partnerConversationId),
        recipientIds: members.map((row: any) => String(row.userId)),
      });
    }
    return fanouts;
  }

  async revokeSharedInvite(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const row = await this.queryOne(
      `UPDATE shared_channel_invites SET status='revoked'
       WHERE id=$1 AND "organizationId"=$2 AND "conversationId"=$3 AND status='pending'
       RETURNING *`,
      [p.inviteId, requireOrganizationId(), p.conversationId],
    );
    if (!row) return RpcErrors.notFound('Pending Connect invite') as never;
    return this.toSharedInviteView(row);
  }

  async markSharedInviteAccepted(p: any) {
    const email = String(p.email ?? '').trim().toLowerCase();
    if (!email || !p.conversationId) return { updated: false };
    const row = await this.queryOne(
      `UPDATE shared_channel_invites SET status='accepted',"acceptedAt"=now()
       WHERE "conversationId"=$1 AND lower(email)=lower($2) AND status='pending'
       RETURNING *`,
      [p.conversationId, email],
    );
    if (!row) return { updated: false };
    await this.db.query(
      `UPDATE conversations SET "isShared"=true,
         "sharedExternalLabel"=COALESCE($1,"sharedExternalLabel")
       WHERE id=$2`,
      [p.externalLabel || email, p.conversationId],
    );
    return { updated: true, invite: this.toSharedInviteView(row) };
  }

  async bindSharedInviteToken(p: any) {
    await this.requireMembership(p.conversationId, p.actorId);
    const token = String(p.token ?? '').trim();
    if (!token || !p.inviteId) return RpcErrors.badRequest('inviteId and token are required') as never;
    const row = await this.queryOne(
      `UPDATE shared_channel_invites SET token=$1
       WHERE id=$2 AND "organizationId"=$3 AND "conversationId"=$4 AND status='pending'
       RETURNING *`,
      [token, p.inviteId, requireOrganizationId(), p.conversationId],
    );
    if (!row) return RpcErrors.notFound('Pending Connect invite') as never;
    return this.toSharedInviteView(row, `/connect-invite/${token}`);
  }

  async listInstalledApps() {
    const rows = await this.queryRows(
      `SELECT * FROM installed_apps WHERE "organizationId"=$1 ORDER BY "createdAt" DESC`,
      [requireOrganizationId()],
    );
    const connections = await this.integrations.connectionMap();
    return rows.map((row: any) => this.toInstalledAppView(row, connections.get(String(row.appKey))));
  }
  async listAppCatalog() {
    const installed = await this.listInstalledApps();
    const keys = new Set(installed.map((app: any) => app.appKey || app.key));
    const connections = await this.integrations.connectionMap();
    return APP_CATALOG.map((app) => {
      const meta = INTEGRATION_CATALOG_META[app.key];
      const connection = connections.get(app.key);
      return {
        key: app.key,
        name: app.name,
        description: app.description,
        icon: app.icon,
        category: app.category,
        configurable: Boolean((app as { configurable?: boolean }).configurable) || Boolean(meta),
        installed: keys.has(app.key),
        oauthRequired: Boolean(meta?.oauthRequired),
        capabilities: meta?.capabilities ?? [],
        connected: connection?.status === 'connected',
        connectionStatus: connection?.status ?? null,
        providerAccountName: connection?.providerAccountName ?? null,
      };
    });
  }
  async installApp(p: any) {
    const catalog = APP_CATALOG.find((app) => app.key === p.appKey);
    if (!catalog) return RpcErrors.notFound('App');
    const config = this.normalizeAppConfig(String(p.appKey), p.config ?? {});
    const row = await this.queryOne(
      `INSERT INTO installed_apps ("organizationId","appKey","config","installedBy") VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT ("organizationId","appKey") DO UPDATE SET config=EXCLUDED.config RETURNING *`,
      [requireOrganizationId(), p.appKey, JSON.stringify(config), p.actorId],
    );
    const connection = (await this.integrations.connectionMap()).get(String(p.appKey));
    return this.toInstalledAppView(row, connection);
  }
  async uninstallApp(p: any) {
    await this.db.query(`DELETE FROM installed_apps WHERE "organizationId"=$1 AND "appKey"=$2`, [requireOrganizationId(), p.appKey]);
    if (INTEGRATION_CATALOG_META[String(p.appKey)]) {
      await this.integrations.disconnectOauth({ appKey: p.appKey }).catch(() => undefined);
    }
    return { deleted: true };
  }

  private toInstalledAppView(row: any, connection?: any) {
    const catalog = APP_CATALOG.find((app) => app.key === row.appKey);
    const meta = INTEGRATION_CATALOG_META[String(row.appKey)];
    return {
      id: String(row.id),
      organizationId: String(row.organizationId),
      appKey: String(row.appKey),
      key: String(row.appKey),
      name: catalog?.name,
      description: catalog?.description,
      config: row.config && typeof row.config === 'object' ? row.config : {},
      installedBy: String(row.installedBy),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      configurable: Boolean(catalog && (catalog as { configurable?: boolean }).configurable) || Boolean(meta),
      category: catalog?.category ?? 'integration',
      oauthRequired: Boolean(meta?.oauthRequired),
      capabilities: meta?.capabilities ?? [],
      connected: connection?.status === 'connected',
      connectionStatus: connection?.status ?? null,
      providerAccountName: connection?.providerAccountName ?? null,
    };
  }

  private defaultQuestions(appKey: string) {
    if (appKey === 'dsu') return [...DEFAULT_DSU_QUESTIONS];
    if (appKey === 'daily-meeting') return [...DEFAULT_MEETING_QUESTIONS];
    return [...DEFAULT_STANDUP_QUESTIONS];
  }

  private botDisplayName(appKey: string) {
    if (appKey === 'dsu') return 'DSU Bot';
    if (appKey === 'daily-meeting') return 'Daily Meeting Bot';
    return 'Standup Bot';
  }

  private normalizeAppConfig(appKey: string, raw: Record<string, unknown>) {
    if (INTEGRATION_CATALOG_META[appKey]) {
      const config: Record<string, unknown> = {};
      if (raw.defaultRepo) config.defaultRepo = String(raw.defaultRepo).trim();
      if (raw.defaultProjectKey) {
        config.defaultProjectKey = String(raw.defaultProjectKey).trim().toUpperCase();
      }
      if (raw.eventsConversationId) {
        config.eventsConversationId = String(raw.eventsConversationId).trim();
      }
      if (raw.webhookSecret) config.webhookSecret = String(raw.webhookSecret).trim();
      return config;
    }
    if (!BOT_APP_KEYS.has(appKey)) {
      return raw && typeof raw === 'object' ? raw : {};
    }
    const conversationId = String(raw.conversationId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
      return RpcErrors.badRequest('Select a channel for the bot to post in') as never;
    }
    const time = this.normalizeClockTime(String(raw.time ?? '09:30').trim());
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return RpcErrors.badRequest('time must be HH:mm') as never;
    }
    const timezone = String(raw.timezone ?? 'UTC').trim() || 'UTC';
    const weekdays = Array.isArray(raw.weekdays)
      ? raw.weekdays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
      : [1, 2, 3, 4, 5];
    const questions = Array.isArray(raw.questions)
      ? raw.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 8)
      : this.defaultQuestions(appKey);
    if (!questions.length) {
      return RpcErrors.badRequest('Add at least one standup question') as never;
    }
    const summaryOffsetMinutes = Math.min(
      24 * 60,
      Math.max(30, Number(raw.summaryOffsetMinutes ?? 480) || 480),
    );
    return {
      conversationId,
      time,
      timezone,
      weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5],
      questions,
      summaryOffsetMinutes,
      mode: appKey === 'dsu' ? 'dsu' : appKey === 'daily-meeting' ? 'daily-meeting' : 'standup',
    };
  }

  private zonedClock(timeZone: string, at = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const hour = get('hour').padStart(2, '0');
    const minute = get('minute').padStart(2, '0');
    return {
      runDate: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${hour}:${minute}`,
      minutesOfDay: Number(hour) * 60 + Number(minute),
      weekday: weekdayMap[get('weekday')] ?? at.getUTCDay(),
    };
  }

  /** Normalize "9:5" / "21:50" / "21:50:00" / "10:36 PM" → "21:50" */
  private normalizeClockTime(raw: unknown): string {
    const text = String(raw ?? '').trim();
    const ampm = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (ampm) {
      let hour = Number(ampm[1]) % 12;
      if (/pm/i.test(ampm[3])) hour += 12;
      return `${String(hour).padStart(2, '0')}:${ampm[2]}`;
    }
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return text;
    const hour = Number(match[1]);
    if (hour > 23) return text;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
  }

  private timeToMinutes(raw: unknown): number | null {
    const normalized = this.normalizeClockTime(raw);
    const match = normalized.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private buildPromptBody(appKey: string, questions: string[]) {
    const title =
      appKey === 'dsu'
        ? 'Daily Stand-Up'
        : appKey === 'daily-meeting'
          ? 'Daily Meeting Check-in'
          : 'Daily Standup';
    const lines = [
      `*${title}* — please reply in this thread (or use \`/standup your update\`).`,
      '',
      ...questions.map((question, index) => `${index + 1}. ${question}`),
      '',
      '_Tip: `/standup summary` posts today’s collected updates._',
    ];
    return lines.join('\n');
  }

  private async postBotMessage(opts: {
    organizationId: string;
    conversationId: string;
    senderId: string;
    body: string;
    botUsername: string;
    threadRootId?: string | null;
  }) {
    const saved = await this.queryOne(
      `INSERT INTO messages (
         "organizationId","conversationId","senderId",body,type,
         "replyToMessageId","threadRootId","attachmentUrl","attachmentMime","attachmentName","attachmentSize",
         mentions,"linkPreview",poll,"botUsername","botIconUrl"
       ) VALUES (
         $1,$2,$3,$4,'text',
         NULL,$5,NULL,NULL,NULL,NULL,
         '[]'::jsonb,NULL,NULL,$6,NULL
       ) RETURNING *`,
      [
        opts.organizationId,
        opts.conversationId,
        opts.senderId,
        opts.body.slice(0, 4000),
        opts.threadRootId ?? null,
        opts.botUsername.slice(0, 80),
      ],
    );
    if (!saved) return null;
    await this.db.query(
      `UPDATE conversations SET "lastMessageAt"=$1, "updatedAt"=now() WHERE id=$2`,
      [saved.createdAt, opts.conversationId],
    );
    const members = await this.queryRows(
      `SELECT "userId" FROM conversation_members
       WHERE "conversationId"=$1 AND "leftAt" IS NULL`,
      [opts.conversationId],
    );
    const recipientIds = members.map((member: { userId: string }) => String(member.userId));
    const createdAt = new Date(saved.createdAt).toISOString();
    return {
      id: String(saved.id),
      conversationId: opts.conversationId,
      senderId: String(saved.senderId),
      body: String(saved.body),
      type: 'text',
      replyToMessageId: null,
      threadRootId: opts.threadRootId ? String(opts.threadRootId) : null,
      attachmentUrl: null,
      attachmentMime: null,
      attachmentName: null,
      attachmentSize: null,
      mentions: [],
      reactions: [],
      linkPreview: null,
      poll: null,
      pinned: false,
      editedAt: null,
      deletedForEveryone: false,
      botUsername: opts.botUsername,
      botIconUrl: null,
      seenBy: [] as string[],
      createdAt,
      updatedAt: createdAt,
      recipientIds,
    };
  }

  private formatSummary(responses: Record<string, any>, questions: string[]) {
    const entries = Object.entries(responses || {});
    if (!entries.length) {
      return '_No standup responses yet._';
    }
    return entries
      .map(([userId, value]) => {
        const body = typeof value === 'string' ? value : String(value?.body ?? '');
        return `• <@${userId}>\n${body || '_empty_'}`;
      })
      .join('\n\n');
  }

  async runStandupNow(p: any) {
    const appKey = String(p.appKey || 'standup');
    if (!BOT_APP_KEYS.has(appKey)) return RpcErrors.badRequest('Unknown bot app');
    const installed = await this.queryOne(
      `SELECT * FROM installed_apps WHERE "organizationId"=$1 AND "appKey"=$2`,
      [requireOrganizationId(), appKey],
    );
    if (!installed) return RpcErrors.notFound('Install this bot from Apps first');
    const config = this.normalizeAppConfig(appKey, {
      ...(installed.config || {}),
      ...(p.conversationId ? { conversationId: p.conversationId } : {}),
    });
    const created = await this.createStandupRun({
      organizationId: requireOrganizationId(),
      appKey,
      installedBy: installed.installedBy || p.actorId,
      config,
      force: true,
    });
    if (!created?.message) {
      return RpcErrors.badRequest(
        'Could not post the standup prompt. Check the bot channel and try again.',
      );
    }
    return created;
  }

  private async createStandupRun(opts: {
    organizationId: string;
    appKey: string;
    installedBy: string;
    config: any;
    force?: boolean;
  }) {
    const clock = this.zonedClock(String(opts.config.timezone || 'UTC'));
    const scheduledTime = this.normalizeClockTime(opts.config.time);
    // One auto-run per org/app/channel/day/time-slot (not once per calendar day forever).
    // Fits varchar(16): "YYYY-MM-DD@HH:mm"
    const scheduledSlotKey = `${clock.runDate}@${scheduledTime}`;

    if (!opts.force) {
      const weekdays = Array.isArray(opts.config.weekdays)
        ? opts.config.weekdays.map((d: unknown) => Number(d))
        : [1, 2, 3, 4, 5];
      if (!weekdays.includes(clock.weekday)) return null;

      const scheduledMinutes = this.timeToMinutes(scheduledTime);
      if (scheduledMinutes == null) return null;
      // Grace window: fire during the scheduled minute and up to 15 minutes after
      // so a 30s dispatcher tick (and slow saves) cannot miss the slot forever.
      const delta = clock.minutesOfDay - scheduledMinutes;
      if (delta < 0 || delta > 15) return null;

      // Block only this exact time-slot (YYYY-MM-DD@HH:mm). Changing the schedule
      // time the same day can fire again; the same slot cannot.
      const existing = await this.queryOne(
        `SELECT id FROM standup_runs
         WHERE "organizationId"=$1 AND "appKey"=$2 AND "conversationId"=$3 AND "runDate"=$4`,
        [
          opts.organizationId,
          opts.appKey,
          opts.config.conversationId,
          scheduledSlotKey,
        ],
      );
      if (existing) return null;
    }

    // Scheduled runs use YYYY-MM-DD@HH:mm (16). Manual runs must stay ≤16 (column width).
    const runDate = opts.force
      ? `${clock.runDate}${Date.now().toString(36).slice(-6)}`
      : scheduledSlotKey;

    const prompt = await this.postBotMessage({
      organizationId: opts.organizationId,
      conversationId: opts.config.conversationId,
      senderId: opts.installedBy,
      body: this.buildPromptBody(
        opts.appKey,
        Array.isArray(opts.config.questions)
          ? opts.config.questions
          : this.defaultQuestions(opts.appKey),
      ),
      botUsername: this.botDisplayName(opts.appKey),
    });
    if (!prompt) return null;

    const run = await this.queryOne(
      `INSERT INTO standup_runs (
         "organizationId","appKey","conversationId","promptMessageId","runDate","status","responses"
       ) VALUES ($1,$2,$3,$4,$5,'open','{}'::jsonb) RETURNING *`,
      [
        opts.organizationId,
        opts.appKey,
        opts.config.conversationId,
        prompt.id,
        runDate,
      ],
    );

    return { message: prompt, run };
  }

  async dispatchDueStandups() {
    const apps = await this.queryRows(
      `SELECT * FROM installed_apps WHERE "appKey" = ANY($1::text[])`,
      [['standup', 'dsu', 'daily-meeting']],
    );
    const messages: any[] = [];
    for (const app of apps) {
      try {
        const rawConfig =
          typeof app.config === 'string'
            ? JSON.parse(app.config || '{}')
            : app.config || {};
        const config = this.normalizeAppConfig(String(app.appKey), rawConfig);
        const created = await this.createStandupRun({
          organizationId: String(app.organizationId),
          appKey: String(app.appKey),
          installedBy: String(app.installedBy),
          config,
          force: false,
        });
        if (created?.message) {
          // eslint-disable-next-line no-console
          console.info(
            `[standup] auto-posted ${app.appKey} → ${config.conversationId} at ${config.time} ${config.timezone}`,
          );
          messages.push(created.message);
        }

        const openRuns = await this.queryRows(
          `SELECT * FROM standup_runs
           WHERE "organizationId"=$1 AND "appKey"=$2 AND "conversationId"=$3 AND status='open'`,
          [app.organizationId, app.appKey, config.conversationId],
        );
        for (const run of openRuns) {
          const promptedAt = new Date(run.promptedAt || run.createdAt).getTime();
          const offsetMs = Math.max(30, Number(config.summaryOffsetMinutes || 480)) * 60_000;
          if (Date.now() - promptedAt < offsetMs) continue;
          const summary = await this.postStandupSummary({
            organizationId: String(app.organizationId),
            appKey: String(app.appKey),
            conversationId: String(config.conversationId),
            installedBy: String(app.installedBy),
            run,
            questions: Array.isArray(config.questions)
              ? config.questions
              : this.defaultQuestions(String(app.appKey)),
          });
          if (summary) messages.push(summary);
        }
      } catch (error) {
        // Keep dispatching other apps; log so silent config errors are visible.
        // eslint-disable-next-line no-console
        console.warn(
          `[standup] dispatch skipped for ${app.appKey}/${app.organizationId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return messages;
  }

  private async postStandupSummary(opts: {
    organizationId: string;
    appKey: string;
    conversationId: string;
    installedBy: string;
    run: any;
    questions: string[];
  }) {
    const responses =
      typeof opts.run.responses === 'string'
        ? JSON.parse(opts.run.responses)
        : opts.run.responses || {};
    const body = [
      `*${this.botDisplayName(opts.appKey)} summary* for ${opts.run.runDate}`,
      '',
      this.formatSummary(responses, opts.questions),
    ].join('\n');
    const message = await this.postBotMessage({
      organizationId: opts.organizationId,
      conversationId: opts.conversationId,
      senderId: opts.installedBy,
      body,
      botUsername: this.botDisplayName(opts.appKey),
      threadRootId: opts.run.promptMessageId || null,
    });
    await this.db.query(
      `UPDATE standup_runs SET status='closed', "summarizedAt"=now() WHERE id=$1`,
      [opts.run.id],
    );
    return message;
  }

  async collectStandupReply(p: any) {
    if (p.botUsername) return { collected: false };
    const body = String(p.body ?? '').trim();
    if (!body || !p.threadRootId || !p.senderId) return { collected: false };
    const run = await this.queryOne(
      `SELECT * FROM standup_runs
       WHERE "conversationId"=$1 AND "promptMessageId"=$2 AND status='open'
       LIMIT 1`,
      [p.conversationId, p.threadRootId],
    );
    if (!run) return { collected: false };
    const responses =
      typeof run.responses === 'string' ? JSON.parse(run.responses) : { ...(run.responses || {}) };
    responses[String(p.senderId)] = {
      body: body.slice(0, 4000),
      messageId: p.messageId ?? null,
      at: new Date().toISOString(),
    };
    await this.db.query(`UPDATE standup_runs SET responses=$1::jsonb WHERE id=$2`, [
      JSON.stringify(responses),
      run.id,
    ]);
    return { collected: true, runId: run.id };
  }

  async getOpenStandupRun(conversationId: string) {
    const run = await this.queryOne(
      `SELECT id, "appKey", "promptMessageId", "runDate", responses
       FROM standup_runs
       WHERE "conversationId"=$1 AND status='open'
       ORDER BY "promptedAt" DESC LIMIT 1`,
      [conversationId],
    );
    if (!run) return null;
    return {
      id: String(run.id),
      appKey: String(run.appKey),
      promptMessageId: run.promptMessageId ? String(run.promptMessageId) : null,
      runDate: String(run.runDate),
      responses: run.responses || {},
    };
  }

  async summarizeStandup(p: any) {
    const requestedKey =
      p.appKey != null && String(p.appKey).trim()
        ? String(p.appKey).trim()
        : null;
    const appKeyFilter =
      requestedKey && BOT_APP_KEYS.has(requestedKey) ? requestedKey : null;
    const run = await this.queryOne(
      `SELECT * FROM standup_runs
       WHERE "organizationId"=$1 AND "conversationId"=$2 AND status='open'
         AND ($3::text IS NULL OR "appKey"=$3)
       ORDER BY "promptedAt" DESC LIMIT 1`,
      [requireOrganizationId(), p.conversationId, appKeyFilter],
    );
    if (!run) return RpcErrors.notFound('No open standup in this channel');
    const installed = await this.queryOne(
      `SELECT * FROM installed_apps WHERE "organizationId"=$1 AND "appKey"=$2`,
      [requireOrganizationId(), run.appKey],
    );
    const config = installed
      ? this.normalizeAppConfig(String(run.appKey), installed.config || {})
      : { questions: this.defaultQuestions(String(run.appKey)) };
    const questions = Array.isArray((config as any).questions)
      ? (config as any).questions
      : this.defaultQuestions(String(run.appKey));
    const message = await this.postStandupSummary({
      organizationId: requireOrganizationId(),
      appKey: String(run.appKey),
      conversationId: String(p.conversationId),
      installedBy: installed?.installedBy || p.actorId,
      run,
      questions,
    });
    return { message };
  }
}
