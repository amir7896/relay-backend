import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RpcErrors } from '@app/common';
import { requireOrganizationId } from '@app/database';

const OAUTH_APPS = new Set(['github', 'jira', 'google-drive', 'zoom']);

export const INTEGRATION_CATALOG_META: Record<
  string,
  {
    oauthRequired: boolean;
    capabilities: Array<'unfurl' | 'create_issue' | 'events' | 'meetings'>;
  }
> = {
  github: {
    oauthRequired: true,
    capabilities: ['unfurl', 'create_issue', 'events'],
  },
  jira: {
    oauthRequired: true,
    capabilities: ['unfurl', 'create_issue', 'events'],
  },
  'google-drive': {
    oauthRequired: true,
    capabilities: ['unfurl'],
  },
  zoom: {
    oauthRequired: true,
    capabilities: ['meetings'],
  },
};

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private async queryOne(sql: string, params: unknown[] = []) {
    const rows = await this.queryRows(sql, params);
    return rows[0] ?? null;
  }

  private async queryRows(sql: string, params: unknown[] = []) {
    const result = await this.db.query(sql, params);
    return Array.isArray(result) ? result : result?.rows ?? [];
  }

  private encryptionKey(): Buffer {
    const raw =
      this.config.get<string>('INTEGRATIONS_TOKEN_ENCRYPTION_KEY') ||
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'relay-dev-integrations-key';
    return createHash('sha256').update(raw).digest();
  }

  encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
  }

  decryptSecret(blob: string): string {
    const [version, ivB64, tagB64, dataB64] = String(blob || '').split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Invalid encrypted token');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private toConnectionView(row: any) {
    return {
      appKey: String(row.appKey),
      status: row.status || 'disconnected',
      providerAccountId: row.providerAccountId ? String(row.providerAccountId) : null,
      providerAccountName: row.providerAccountName
        ? String(row.providerAccountName)
        : null,
      scopes: row.scopes ? String(row.scopes) : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
      connected: row.status === 'connected',
    };
  }

  async getOauthStatus(p: { appKey?: string }) {
    const orgId = requireOrganizationId();
    if (p.appKey) {
      const row = await this.queryOne(
        `SELECT * FROM app_oauth_connections
         WHERE "organizationId"=$1 AND "appKey"=$2 LIMIT 1`,
        [orgId, p.appKey],
      );
      if (!row) {
        return {
          appKey: p.appKey,
          status: 'disconnected',
          providerAccountId: null,
          providerAccountName: null,
          scopes: null,
          expiresAt: null,
          meta: {},
          connected: false,
        };
      }
      return this.toConnectionView(row);
    }
    const rows = await this.queryRows(
      `SELECT * FROM app_oauth_connections WHERE "organizationId"=$1`,
      [orgId],
    );
    return rows.map((row: any) => this.toConnectionView(row));
  }

  async connectionMap(orgId = requireOrganizationId()) {
    const rows = await this.queryRows(
      `SELECT * FROM app_oauth_connections WHERE "organizationId"=$1`,
      [orgId],
    );
    const map = new Map<string, any>();
    for (const row of rows) {
      map.set(String(row.appKey), row);
    }
    return map;
  }

  async upsertOauth(p: any) {
    const appKey = String(p.appKey || '').trim();
    if (!OAUTH_APPS.has(appKey)) {
      return RpcErrors.badRequest('Unsupported integration') as never;
    }
    const accessToken = String(p.accessToken || '').trim();
    if (!accessToken) {
      return RpcErrors.badRequest('accessToken is required') as never;
    }
    const orgId = requireOrganizationId();
    const accessTokenEnc = this.encryptSecret(accessToken);
    const refreshTokenEnc = p.refreshToken
      ? this.encryptSecret(String(p.refreshToken))
      : null;
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
    const row = await this.queryOne(
      `INSERT INTO app_oauth_connections (
         "organizationId","appKey","providerAccountId","providerAccountName",
         "accessTokenEnc","refreshTokenEnc","tokenType",scopes,"expiresAt",meta,status,"installedBy"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'connected',$11)
       ON CONFLICT ("organizationId","appKey") DO UPDATE SET
         "providerAccountId"=EXCLUDED."providerAccountId",
         "providerAccountName"=EXCLUDED."providerAccountName",
         "accessTokenEnc"=EXCLUDED."accessTokenEnc",
         "refreshTokenEnc"=COALESCE(EXCLUDED."refreshTokenEnc", app_oauth_connections."refreshTokenEnc"),
         "tokenType"=EXCLUDED."tokenType",
         scopes=EXCLUDED.scopes,
         "expiresAt"=EXCLUDED."expiresAt",
         meta=EXCLUDED.meta,
         status='connected',
         "updatedAt"=now()
       RETURNING *`,
      [
        orgId,
        appKey,
        p.providerAccountId ?? null,
        p.providerAccountName ?? null,
        accessTokenEnc,
        refreshTokenEnc,
        p.tokenType || 'bearer',
        p.scopes ?? null,
        p.expiresAt ? new Date(p.expiresAt) : null,
        JSON.stringify(meta),
        p.actorId,
      ],
    );

    await this.db.query(
      `INSERT INTO installed_apps ("organizationId","appKey","config","installedBy")
       VALUES ($1,$2,'{}'::jsonb,$3)
       ON CONFLICT ("organizationId","appKey") DO NOTHING`,
      [orgId, appKey, p.actorId],
    );

    return this.toConnectionView(row);
  }

  async disconnectOauth(p: any) {
    const appKey = String(p.appKey || '').trim();
    const orgId = requireOrganizationId();
    await this.db.query(
      `DELETE FROM app_oauth_connections WHERE "organizationId"=$1 AND "appKey"=$2`,
      [orgId, appKey],
    );
    await this.db.query(
      `DELETE FROM installed_apps WHERE "organizationId"=$1 AND "appKey"=$2`,
      [orgId, appKey],
    );
    return { disconnected: true, appKey };
  }

  private async loadConnection(appKey: string, orgId = requireOrganizationId()) {
    const row = await this.queryOne(
      `SELECT * FROM app_oauth_connections
       WHERE "organizationId"=$1 AND "appKey"=$2 AND status='connected'
       LIMIT 1`,
      [orgId, appKey],
    );
    if (!row) return null;
    let accessToken = this.decryptSecret(row.accessTokenEnc);
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now() + 60_000) {
      const refreshed = await this.refreshConnection(row);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        row.meta = refreshed.meta ?? row.meta;
      }
    }
    return { row, accessToken };
  }

  private async refreshConnection(row: any): Promise<{
    accessToken: string;
    meta?: Record<string, unknown>;
  } | null> {
    if (!row.refreshTokenEnc) return null;
    const refreshToken = this.decryptSecret(row.refreshTokenEnc);
    const appKey = String(row.appKey);

    if (appKey === 'jira') {
      const clientId = this.config.get<string>('JIRA_CLIENT_ID');
      const clientSecret = this.config.get<string>('JIRA_CLIENT_SECRET');
      if (!clientId || !clientSecret) return null;
      const response = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      await this.db.query(
        `UPDATE app_oauth_connections SET
           "accessTokenEnc"=$1,
           "refreshTokenEnc"=COALESCE($2,"refreshTokenEnc"),
           "expiresAt"=$3,
           "updatedAt"=now()
         WHERE id=$4`,
        [
          this.encryptSecret(data.access_token),
          data.refresh_token ? this.encryptSecret(data.refresh_token) : null,
          data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : null,
          row.id,
        ],
      );
      return { accessToken: data.access_token };
    }

    if (appKey === 'google-drive') {
      const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
      const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
      if (!clientId || !clientSecret) return null;
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        access_token: string;
        expires_in?: number;
      };
      await this.db.query(
        `UPDATE app_oauth_connections SET
           "accessTokenEnc"=$1, "expiresAt"=$2, "updatedAt"=now()
         WHERE id=$3`,
        [
          this.encryptSecret(data.access_token),
          data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : null,
          row.id,
        ],
      );
      return { accessToken: data.access_token };
    }

    if (appKey === 'zoom') {
      const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
      const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
      if (!clientId || !clientSecret) return null;
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      const response = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      await this.db.query(
        `UPDATE app_oauth_connections SET
           "accessTokenEnc"=$1,
           "refreshTokenEnc"=COALESCE($2,"refreshTokenEnc"),
           "expiresAt"=$3,
           "updatedAt"=now()
         WHERE id=$4`,
        [
          this.encryptSecret(data.access_token),
          data.refresh_token ? this.encryptSecret(data.refresh_token) : null,
          data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : null,
          row.id,
        ],
      );
      return { accessToken: data.access_token };
    }

    return null;
  }

  async unfurlLink(p: any) {
    const url = String(p.url || '').trim();
    if (!url) return RpcErrors.badRequest('url is required') as never;

    const github = url.match(
      /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)(?:\/(issues|pull)\/(\d+))?/i,
    );
    if (github) {
      return this.unfurlGithub(url, github[1], github[2], github[3], github[4]);
    }

    const jira = url.match(
      /^https?:\/\/([^.]+)\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/i,
    );
    if (jira) {
      return this.unfurlJira(url, jira[2]);
    }

    const drive = url.match(
      /^https?:\/\/(?:drive|docs)\.google\.com\//i,
    );
    if (drive) {
      return this.unfurlDrive(url);
    }

    return {
      url,
      title: url,
      description: '',
      image: null,
      provider: null,
      externalId: null,
    };
  }

  private async unfurlGithub(
    url: string,
    owner: string,
    repo: string,
    kind?: string,
    number?: string,
  ) {
    const conn = await this.loadConnection('github').catch(() => null);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Relay-Integrations',
    };
    if (conn?.accessToken) {
      headers.Authorization = `Bearer ${conn.accessToken}`;
    }

    if (kind && number) {
      const api =
        kind === 'pull'
          ? `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`
          : `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
      const response = await fetch(api, { headers });
      if (response.ok) {
        const data = (await response.json()) as {
          title?: string;
          body?: string;
          state?: string;
          user?: { login?: string };
          html_url?: string;
          number?: number;
        };
        return {
          url: data.html_url || url,
          title: `${owner}/${repo}#${data.number ?? number}: ${data.title || ''}`.slice(
            0,
            200,
          ),
          description: `${data.state || ''} · ${data.user?.login || ''} — ${(data.body || '').slice(0, 280)}`.trim(),
          image: null,
          provider: 'github',
          externalId: `${owner}/${repo}#${data.number ?? number}`,
        };
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers },
    );
    if (response.ok) {
      const data = (await response.json()) as {
        full_name?: string;
        description?: string;
        html_url?: string;
        stargazers_count?: number;
        language?: string;
      };
      return {
        url: data.html_url || url,
        title: data.full_name || `${owner}/${repo}`,
        description: `${data.language || 'Repo'}${typeof data.stargazers_count === 'number' ? ` · ★ ${data.stargazers_count}` : ''}${data.description ? ` — ${data.description}` : ''}`.slice(
          0,
          400,
        ),
        image: null,
        provider: 'github',
        externalId: data.full_name || `${owner}/${repo}`,
      };
    }

    return {
      url,
      title: `${owner}/${repo}`,
      description: 'GitHub repository',
      image: null,
      provider: 'github',
      externalId: `${owner}/${repo}`,
    };
  }

  private async unfurlJira(url: string, issueKey: string) {
    const conn = await this.loadConnection('jira').catch(() => null);
    if (!conn) {
      return {
        url,
        title: issueKey,
        description: 'Jira issue (connect Jira to load details)',
        image: null,
        provider: 'jira',
        externalId: issueKey,
      };
    }
    const cloudId = String((conn.row.meta as any)?.cloudId || '');
    if (!cloudId) {
      return {
        url,
        title: issueKey,
        description: 'Jira connected but cloud site is missing — reconnect',
        image: null,
        provider: 'jira',
        externalId: issueKey,
      };
    }
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`,
      {
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      return {
        url,
        title: issueKey,
        description: 'Could not load Jira issue',
        image: null,
        provider: 'jira',
        externalId: issueKey,
      };
    }
    const data = (await response.json()) as {
      key?: string;
      fields?: {
        summary?: string;
        status?: { name?: string };
        issuetype?: { name?: string };
        assignee?: { displayName?: string };
      };
    };
    const summary = data.fields?.summary || '';
    return {
      url,
      title: `${data.key || issueKey}: ${summary}`.slice(0, 200),
      description: `${data.fields?.issuetype?.name || 'Issue'} · ${data.fields?.status?.name || ''}${data.fields?.assignee?.displayName ? ` · ${data.fields.assignee.displayName}` : ''}`.trim(),
      image: null,
      provider: 'jira',
      externalId: data.key || issueKey,
    };
  }

  private async unfurlDrive(url: string) {
    const conn = await this.loadConnection('google-drive').catch(() => null);
    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!conn || !fileIdMatch) {
      return {
        url,
        title: 'Google Drive file',
        description: conn
          ? 'Open in Drive'
          : 'Connect Google Drive to unfurl file details',
        image: null,
        provider: 'google-drive',
        externalId: fileIdMatch?.[1] ?? null,
      };
    }
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileIdMatch[1]}?fields=id,name,mimeType,owners,webViewLink,iconLink`,
      { headers: { Authorization: `Bearer ${conn.accessToken}` } },
    );
    if (!response.ok) {
      return {
        url,
        title: 'Google Drive file',
        description: 'Could not load Drive metadata',
        image: null,
        provider: 'google-drive',
        externalId: fileIdMatch[1],
      };
    }
    const data = (await response.json()) as {
      name?: string;
      mimeType?: string;
      webViewLink?: string;
      iconLink?: string;
      owners?: Array<{ displayName?: string }>;
    };
    return {
      url: data.webViewLink || url,
      title: data.name || 'Drive file',
      description: `${data.mimeType || 'file'}${data.owners?.[0]?.displayName ? ` · ${data.owners[0].displayName}` : ''}`,
      image: data.iconLink || null,
      provider: 'google-drive',
      externalId: fileIdMatch[1],
    };
  }

  async listProjects(p: any) {
    const appKey = String(p.appKey || '');
    if (appKey === 'github') {
      const conn = await this.loadConnection('github');
      if (!conn) return RpcErrors.badRequest('GitHub is not connected') as never;
      const response = await fetch(
        'https://api.github.com/user/repos?per_page=50&sort=updated',
        {
          headers: {
            Authorization: `Bearer ${conn.accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Relay-Integrations',
          },
        },
      );
      if (!response.ok) {
        return RpcErrors.badRequest('Could not list GitHub repositories') as never;
      }
      const repos = (await response.json()) as Array<{
        full_name: string;
        private: boolean;
        html_url: string;
      }>;
      return repos.map((repo) => ({
        id: repo.full_name,
        name: repo.full_name,
        url: repo.html_url,
        private: repo.private,
      }));
    }

    if (appKey === 'jira') {
      const conn = await this.loadConnection('jira');
      if (!conn) return RpcErrors.badRequest('Jira is not connected') as never;
      const cloudId = String((conn.row.meta as any)?.cloudId || '');
      if (!cloudId) {
        return RpcErrors.badRequest('Reconnect Jira to select a site') as never;
      }
      const response = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?maxResults=50`,
        {
          headers: {
            Authorization: `Bearer ${conn.accessToken}`,
            Accept: 'application/json',
          },
        },
      );
      if (!response.ok) {
        return RpcErrors.badRequest('Could not list Jira projects') as never;
      }
      const data = (await response.json()) as {
        values?: Array<{ id: string; key: string; name: string }>;
      };
      return (data.values || []).map((project) => ({
        id: project.key,
        name: `${project.key} — ${project.name}`,
        key: project.key,
      }));
    }

    return RpcErrors.badRequest('Unsupported appKey') as never;
  }

  async createIssueFromMessage(p: any) {
    const appKey = String(p.appKey || '');
    const orgId = requireOrganizationId();
    const message = await this.queryOne(
      `SELECT id, body, "conversationId", "senderId"
       FROM messages
       WHERE id=$1 AND "organizationId"=$2 AND "conversationId"=$3
       LIMIT 1`,
      [p.messageId, orgId, p.conversationId],
    );
    if (!message) return RpcErrors.notFound('Message') as never;

    const title =
      String(p.title || '').trim() ||
      String(message.body || 'Untitled')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) ||
      'Untitled';
    const body =
      String(p.body || '').trim() ||
      `${message.body || ''}\n\n_Created from Relay message ${message.id}_`;

    let created: { externalId: string; externalUrl: string; title: string };

    if (appKey === 'github') {
      created = await this.createGithubIssue(p, title, body);
    } else if (appKey === 'jira') {
      created = await this.createJiraIssue(p, title, body);
    } else {
      return RpcErrors.badRequest('Only github and jira support create-from-message') as never;
    }

    await this.db.query(
      `INSERT INTO app_external_refs (
         "organizationId","appKey","conversationId","messageId",
         "externalId","externalUrl",title,"createdBy"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        orgId,
        appKey,
        p.conversationId,
        p.messageId,
        created.externalId,
        created.externalUrl,
        created.title,
        p.actorId,
      ],
    );

    const botMessage = await this.postBotReply({
      conversationId: p.conversationId,
      actorId: p.actorId,
      body: `Created ${appKey === 'jira' ? 'Jira issue' : 'GitHub issue'} **${created.title}**: ${created.externalUrl}`,
      botUsername: appKey === 'jira' ? 'Jira' : 'GitHub',
      replyToMessageId: p.messageId,
    });

    return {
      appKey,
      ...created,
      message: botMessage,
    };
  }

  async createIssueFromListItem(p: any) {
    const appKey = String(p.appKey || 'jira');
    if (appKey !== 'jira') {
      return RpcErrors.badRequest('Only Jira supports push-from-list') as never;
    }
    const orgId = requireOrganizationId();
    const item = await this.queryOne(
      `SELECT i.*, l."conversationId"
       FROM channel_list_items i
       JOIN channel_lists l ON l.id = i."listId"
       WHERE i.id=$1 AND i."listId"=$2 AND l."conversationId"=$3
         AND l."organizationId"=$4
       LIMIT 1`,
      [p.itemId, p.listId, p.conversationId, orgId],
    );
    if (!item) return RpcErrors.notFound('List item') as never;

    if (item.jiraKey && item.jiraUrl) {
      return {
        appKey,
        externalId: String(item.jiraKey),
        externalUrl: String(item.jiraUrl),
        title: `${item.jiraKey}: ${item.title}`,
        alreadyLinked: true,
        item: {
          id: String(item.id),
          listId: String(item.listId),
          title: String(item.title ?? ''),
          description: String(item.description ?? ''),
          status: item.status,
          priority: item.priority,
          labels: Array.isArray(item.labels) ? item.labels : [],
          estimate: item.estimate ?? null,
          parentItemId: item.parentItemId ? String(item.parentItemId) : null,
          assigneeId: item.assigneeId ? String(item.assigneeId) : null,
          dueAt: item.dueAt ? new Date(item.dueAt).toISOString() : null,
          sortOrder: Number(item.sortOrder) || 0,
          jiraKey: String(item.jiraKey),
          jiraUrl: String(item.jiraUrl),
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
          updatedAt: item.updatedAt
            ? new Date(item.updatedAt).toISOString()
            : '',
        },
      };
    }

    const title =
      String(p.title || '').trim() ||
      String(item.title || 'Untitled').trim().slice(0, 120) ||
      'Untitled';
    const description = String(item.description || '').trim();
    const body =
      String(p.body || '').trim() ||
      [
        description || title,
        '',
        `_Pushed from Relay list item ${item.id}_`,
        item.status ? `Status: ${item.status}` : '',
        item.priority ? `Priority: ${item.priority}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    const created = await this.createJiraIssue(p, title, body);

    const updated = await this.queryOne(
      `UPDATE channel_list_items
       SET "jiraKey"=$1, "jiraUrl"=$2, "updatedAt"=now()
       WHERE id=$3 AND "listId"=$4
       RETURNING *`,
      [created.externalId, created.externalUrl, item.id, item.listId],
    );

    await this.db.query(
      `INSERT INTO app_external_refs (
         "organizationId","appKey","conversationId","messageId",
         "externalId","externalUrl",title,"createdBy"
       ) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7)`,
      [
        orgId,
        appKey,
        p.conversationId,
        created.externalId,
        created.externalUrl,
        created.title,
        p.actorId,
      ],
    ).catch(() => undefined);

    const botMessage = await this.postBotReply({
      conversationId: p.conversationId,
      actorId: p.actorId,
      body: `Pushed list item **${title}** to Jira: ${created.externalUrl}`,
      botUsername: 'Jira',
    });

    return {
      appKey,
      ...created,
      alreadyLinked: false,
      item: {
        id: String(updated?.id ?? item.id),
        listId: String(updated?.listId ?? item.listId),
        title: String(updated?.title ?? item.title ?? ''),
        description: String(updated?.description ?? item.description ?? ''),
        status: updated?.status ?? item.status,
        priority: updated?.priority ?? item.priority,
        labels: Array.isArray(updated?.labels)
          ? updated.labels
          : Array.isArray(item.labels)
            ? item.labels
            : [],
        estimate: updated?.estimate ?? item.estimate ?? null,
        parentItemId: (updated?.parentItemId ?? item.parentItemId)
          ? String(updated?.parentItemId ?? item.parentItemId)
          : null,
        assigneeId: (updated?.assigneeId ?? item.assigneeId)
          ? String(updated?.assigneeId ?? item.assigneeId)
          : null,
        dueAt: (updated?.dueAt ?? item.dueAt)
          ? new Date(updated?.dueAt ?? item.dueAt).toISOString()
          : null,
        sortOrder: Number(updated?.sortOrder ?? item.sortOrder) || 0,
        jiraKey: created.externalId,
        jiraUrl: created.externalUrl,
        createdAt: updated?.createdAt
          ? new Date(updated.createdAt).toISOString()
          : '',
        updatedAt: updated?.updatedAt
          ? new Date(updated.updatedAt).toISOString()
          : '',
      },
      message: botMessage,
    };
  }

  private async createGithubIssue(p: any, title: string, body: string) {
    const conn = await this.loadConnection('github');
    if (!conn) return RpcErrors.badRequest('Connect GitHub in Apps first') as never;

    const installed = await this.queryOne(
      `SELECT config FROM installed_apps
       WHERE "organizationId"=$1 AND "appKey"='github' LIMIT 1`,
      [requireOrganizationId()],
    );
    const config =
      installed?.config && typeof installed.config === 'object'
        ? installed.config
        : {};
    const repo = String(p.repo || config.defaultRepo || '').trim();
    if (!repo || !repo.includes('/')) {
      return RpcErrors.badRequest(
        'Set a default repo in Apps (owner/name) or pass repo',
      ) as never;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Relay-Integrations',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return RpcErrors.badRequest(
        `GitHub create failed: ${text.slice(0, 200)}`,
      ) as never;
    }
    const data = (await response.json()) as {
      number: number;
      html_url: string;
      title: string;
    };
    return {
      externalId: `${repo}#${data.number}`,
      externalUrl: data.html_url,
      title: `${repo}#${data.number}: ${data.title}`,
    };
  }

  private async createJiraIssue(p: any, title: string, body: string) {
    const conn = await this.loadConnection('jira');
    if (!conn) return RpcErrors.badRequest('Connect Jira in Apps first') as never;
    const cloudId = String((conn.row.meta as any)?.cloudId || '');
    const siteUrl = String((conn.row.meta as any)?.siteUrl || '');
    if (!cloudId) {
      return RpcErrors.badRequest('Reconnect Jira to select a cloud site') as never;
    }

    const installed = await this.queryOne(
      `SELECT config FROM installed_apps
       WHERE "organizationId"=$1 AND "appKey"='jira' LIMIT 1`,
      [requireOrganizationId()],
    );
    const config =
      installed?.config && typeof installed.config === 'object'
        ? installed.config
        : {};
    const projectKey = String(p.projectKey || config.defaultProjectKey || '').trim();
    if (!projectKey) {
      return RpcErrors.badRequest(
        'Set a default Jira project key in Apps or pass projectKey',
      ) as never;
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: title,
            issuetype: { name: 'Task' },
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: body.slice(0, 4000) }],
                },
              ],
            },
          },
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return RpcErrors.badRequest(
        `Jira create failed: ${text.slice(0, 200)}`,
      ) as never;
    }
    const data = (await response.json()) as { key: string; id: string };
    const externalUrl = siteUrl
      ? `${siteUrl.replace(/\/$/, '')}/browse/${data.key}`
      : `https://jira.atlassian.com/browse/${data.key}`;
    return {
      externalId: data.key,
      externalUrl,
      title: `${data.key}: ${title}`,
    };
  }

  async createZoomMeeting(p: any) {
    const conn = await this.loadConnection('zoom');
    if (!conn) return RpcErrors.badRequest('Connect Zoom in Apps first') as never;
    const topic =
      String(p.topic || '').trim() ||
      `Relay meeting ${new Date().toISOString().slice(0, 16)}`;
    const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        type: 1,
        settings: { join_before_host: true },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return RpcErrors.badRequest(`Zoom create failed: ${text.slice(0, 200)}`) as never;
    }
    const data = (await response.json()) as {
      id: number;
      join_url: string;
      topic: string;
    };
    const botMessage = p.conversationId
      ? await this.postBotReply({
          conversationId: p.conversationId,
          actorId: p.actorId,
          body: `Zoom meeting ready: **${data.topic}** — ${data.join_url}`,
          botUsername: 'Zoom',
        })
      : null;
    return {
      externalId: String(data.id),
      externalUrl: data.join_url,
      title: data.topic,
      message: botMessage,
    };
  }

  async ingestEvent(p: any) {
    const appKey = String(p.appKey || '');
    const orgId = String(p.organizationId || '');
    if (!orgId) return RpcErrors.badRequest('organizationId required') as never;

    const installed = await this.queryOne(
      `SELECT * FROM installed_apps
       WHERE "organizationId"=$1 AND "appKey"=$2 LIMIT 1`,
      [orgId, appKey],
    );
    if (!installed) {
      return { ignored: true, reason: 'app_not_installed' };
    }
    const config =
      installed.config && typeof installed.config === 'object'
        ? (installed.config as Record<string, unknown>)
        : {};
    const conversationId = String(config.eventsConversationId || '').trim();
    if (!conversationId) {
      return { ignored: true, reason: 'no_events_channel' };
    }

    const text = this.formatInboundEvent(appKey, p.eventType, p.payload || {});
    if (!text) return { ignored: true, reason: 'unhandled_event' };

    const message = await this.postBotReply({
      organizationId: orgId,
      conversationId,
      actorId: installed.installedBy,
      body: text,
      botUsername: appKey === 'jira' ? 'Jira' : appKey === 'github' ? 'GitHub' : appKey,
    });
    return { posted: true, message };
  }

  private formatInboundEvent(
    appKey: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): string | null {
    if (appKey === 'github') {
      if (eventType === 'issues' || payload.action) {
        const issue = payload.issue as
          | { html_url?: string; title?: string; number?: number }
          | undefined;
        const repo = payload.repository as { full_name?: string } | undefined;
        const action = String(payload.action || eventType);
        if (issue?.html_url) {
          return `GitHub ${action}: **${repo?.full_name || 'repo'}#${issue.number}** ${issue.title || ''} — ${issue.html_url}`;
        }
      }
      if (payload.pull_request) {
        const pr = payload.pull_request as {
          html_url?: string;
          title?: string;
          number?: number;
        };
        const repo = payload.repository as { full_name?: string } | undefined;
        return `GitHub PR ${payload.action || 'update'}: **${repo?.full_name}#${pr.number}** ${pr.title} — ${pr.html_url}`;
      }
      if (payload.commits && payload.repository) {
        const repo = payload.repository as { full_name?: string };
        const commits = payload.commits as Array<{ message?: string }>;
        return `GitHub push to **${repo.full_name}**: ${commits.length} commit(s)${commits[0]?.message ? ` — ${commits[0].message}` : ''}`;
      }
    }
    if (appKey === 'jira') {
      const issue = (payload.issue || payload) as {
        key?: string;
        fields?: { summary?: string };
        self?: string;
      };
      const key = issue.key || String(payload.issueKey || '');
      if (key) {
        return `Jira ${eventType || 'update'}: **${key}** ${issue.fields?.summary || ''}`.trim();
      }
    }
    return null;
  }

  private async postBotReply(input: {
    organizationId?: string;
    conversationId: string;
    actorId: string;
    body: string;
    botUsername: string;
    replyToMessageId?: string;
  }) {
    const orgId = input.organizationId || requireOrganizationId();
    const members = await this.queryRows(
      `SELECT "userId" FROM conversation_members
       WHERE "conversationId"=$1 AND "leftAt" IS NULL`,
      [input.conversationId],
    );
    const saved = await this.queryOne(
      `INSERT INTO messages (
         "organizationId","conversationId","senderId",body,type,
         "replyToMessageId","botUsername",mentions
       ) VALUES ($1,$2,$3,$4,'text',$5,$6,'[]'::jsonb)
       RETURNING *`,
      [
        orgId,
        input.conversationId,
        input.actorId,
        input.body,
        input.replyToMessageId || null,
        input.botUsername,
      ],
    );
    await this.db.query(
      `UPDATE conversations SET "lastMessageAt"=now() WHERE id=$1`,
      [input.conversationId],
    );
    const createdAt = saved.createdAt
      ? new Date(saved.createdAt).toISOString()
      : new Date().toISOString();
    return {
      id: String(saved.id),
      organizationId: orgId,
      conversationId: input.conversationId,
      senderId: input.actorId,
      body: input.body,
      type: 'text',
      replyToMessageId: input.replyToMessageId || null,
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
      botUsername: input.botUsername,
      botIconUrl: null,
      createdAt,
      updatedAt: createdAt,
      recipientIds: members.map((row: any) => String(row.userId)),
    };
  }
}
