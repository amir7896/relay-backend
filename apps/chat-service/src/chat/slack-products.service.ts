import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { RpcErrors } from '@app/common';
import { requireOrganizationId } from '@app/database';

const APP_CATALOG = [
  { key: 'google-drive', name: 'Google Drive', description: 'Share and discover Drive files.', icon: 'drive' },
  { key: 'github', name: 'GitHub', description: 'Repository and pull request notifications.', icon: 'github' },
  { key: 'jira', name: 'Jira', description: 'Create and track Jira issues.', icon: 'jira' },
  { key: 'zoom', name: 'Zoom', description: 'Start Zoom meetings from channels.', icon: 'video' },
] as const;
const STATUSES = new Set(['todo', 'doing', 'done']);
const TRIGGERS = new Set(['message_contains', 'channel_created', 'manual']);
const ACTIONS = new Set(['post_message', 'webhook', 'set_reminder']);

@Injectable()
export class SlackProductsService {
  constructor(private readonly db: DataSource) {}

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
    const row = await this.queryOne(
      `INSERT INTO channel_list_items ("listId","title","status","assigneeId","sortOrder") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [p.listId, this.text(p.title, 'title', 500), status, p.assigneeId ?? null, Number(p.sortOrder) || 0],
    );
    if (!row) return RpcErrors.internal('Could not create list item') as never;
    return this.toListItemView(row);
  }

  async updateListItem(p: any) {
    await this.requireList(p);
    if (p.status !== undefined && !STATUSES.has(p.status)) {
      return RpcErrors.badRequest('status must be todo, doing, or done');
    }
    const row = await this.queryOne(
      `UPDATE channel_list_items SET title=COALESCE($1,title), status=COALESCE($2,status),
       "assigneeId"=CASE WHEN $3::boolean THEN $4::uuid ELSE "assigneeId" END,
       "sortOrder"=COALESCE($5,"sortOrder") WHERE id=$6 AND "listId"=$7 RETURNING *`,
      [
        p.title === undefined ? null : this.text(p.title, 'title', 500),
        p.status ?? null,
        p.assigneeId !== undefined,
        p.assigneeId ?? null,
        p.sortOrder ?? null,
        p.itemId,
        p.listId,
      ],
    );
    if (!row) return RpcErrors.notFound('Channel list item');
    return this.toListItemView(row);
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
      createdBy: String(row.createdBy),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      acceptedAt: row.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
      inviteUrl: inviteUrl ?? null,
    };
  }

  async createSharedInvite(p: any) {
    const conversation = await this.requireMembership(p.conversationId, p.actorId);
    if (conversation.type && conversation.type !== 'group') {
      return RpcErrors.badRequest('Slack Connect is only available on channels') as never;
    }
    const email = String(p.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return RpcErrors.badRequest('A valid email is required');
    }
    const existing = await this.queryRows(
      `SELECT id FROM shared_channel_invites
       WHERE "organizationId"=$1 AND "conversationId"=$2 AND lower(email)=lower($3) AND status='pending'
       LIMIT 1`,
      [requireOrganizationId(), p.conversationId, email],
    );
    if (existing[0]) {
      return RpcErrors.badRequest('A pending Connect invite already exists for that email') as never;
    }
    const token = randomBytes(32).toString('hex');
    const row = await this.queryOne(
      `INSERT INTO shared_channel_invites ("organizationId","conversationId","email","token","createdBy")
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [requireOrganizationId(), p.conversationId, email, token, p.actorId],
    );
    return this.toSharedInviteView(row);
  }

  async getSharedInfo(p: any) {
    const conversation = await this.requireMembership(p.conversationId, p.actorId);
    const invites = await this.queryRows(
      `SELECT id,"organizationId","conversationId",email,token,status,"createdBy","createdAt","acceptedAt"
       FROM shared_channel_invites
       WHERE "organizationId"=$1 AND "conversationId"=$2
       ORDER BY "createdAt" DESC`,
      [requireOrganizationId(), p.conversationId],
    );
    return {
      conversationId: p.conversationId,
      isShared: Boolean(conversation.isShared),
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
    };
  }

  async acceptSharedInvite(p: any) {
    const token = String(p.token ?? '').trim();
    const invite = await this.queryOne(
      `SELECT * FROM shared_channel_invites WHERE token=$1 AND status='pending' LIMIT 1`,
      [token],
    );
    if (!invite) return RpcErrors.notFound('Shared channel invite') as never;

    // Membership is granted by the companion workspace guest invite + pendingChannelId.
    // This marks the Connect record and flags the channel as shared.
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
    return this.queryRows(
      `SELECT * FROM installed_apps WHERE "organizationId"=$1 ORDER BY "createdAt" DESC`,
      [requireOrganizationId()],
    );
  }
  async listAppCatalog() {
    const installed = await this.listInstalledApps();
    const keys = new Set(installed.map((app: any) => app.appKey));
    return APP_CATALOG.map((app) => ({ ...app, installed: keys.has(app.key) }));
  }
  async installApp(p: any) {
    if (!APP_CATALOG.some((app) => app.key === p.appKey)) return RpcErrors.notFound('App');
    const row = await this.queryOne(
      `INSERT INTO installed_apps ("organizationId","appKey","config","installedBy") VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT ("organizationId","appKey") DO UPDATE SET config=EXCLUDED.config RETURNING *`,
      [requireOrganizationId(), p.appKey, JSON.stringify(p.config ?? {}), p.actorId],
    );
    return row;
  }
  async uninstallApp(p: any) {
    await this.db.query(`DELETE FROM installed_apps WHERE "organizationId"=$1 AND "appKey"=$2`, [requireOrganizationId(), p.appKey]);
    return { deleted: true };
  }
}
