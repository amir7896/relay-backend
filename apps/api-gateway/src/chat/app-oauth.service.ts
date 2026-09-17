import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  BadRequestAppException,
  REDIS_CLIENT,
} from '@app/common';
import { CHAT_PATTERNS } from '@app/contracts';
import type { UpsertAppOauthPayload } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';

type OauthState = {
  organizationId: string;
  appKey: string;
  actorId: string;
  returnPath: string;
};

const STATE_TTL = 600;

const PROVIDERS = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: 'repo read:user',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
  },
  jira: {
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes:
      'read:jira-work write:jira-work read:me offline_access',
    clientIdEnv: 'JIRA_CLIENT_ID',
    clientSecretEnv: 'JIRA_CLIENT_SECRET',
  },
  'google-drive': {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes:
      'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  zoom: {
    authorizeUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    scopes: 'meeting:write user:read',
    clientIdEnv: 'ZOOM_CLIENT_ID',
    clientSecretEnv: 'ZOOM_CLIENT_SECRET',
  },
} as const;

type ProviderKey = keyof typeof PROVIDERS;

@Injectable()
export class AppOauthService {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private apiPublicUrl(): string {
    return (
      this.config.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.config.get<number>('PORT', 3002)}/api`
    );
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL')?.replace(/\/$/, '') ||
      'http://localhost:5173'
    );
  }

  private redirectUri(): string {
    return `${this.apiPublicUrl()}/chat/apps/oauth/callback`;
  }

  credentialsConfigured(appKey: string): boolean {
    const provider = PROVIDERS[appKey as ProviderKey];
    if (!provider) return false;
    return Boolean(
      this.config.get<string>(provider.clientIdEnv) &&
        this.config.get<string>(provider.clientSecretEnv),
    );
  }

  async start(input: {
    appKey: string;
    organizationId: string;
    actorId: string;
    returnPath?: string;
  }): Promise<{ authorizeUrl: string }> {
    const appKey = input.appKey as ProviderKey;
    const provider = PROVIDERS[appKey];
    if (!provider) {
      throw new BadRequestAppException('Unsupported integration');
    }
    const clientId = this.config.get<string>(provider.clientIdEnv);
    const clientSecret = this.config.get<string>(provider.clientSecretEnv);
    if (!clientId || !clientSecret) {
      throw new BadRequestAppException(
        `${appKey} OAuth is not configured. Set ${provider.clientIdEnv} and ${provider.clientSecretEnv}.`,
      );
    }

    const state = randomBytes(24).toString('hex');
    const payload: OauthState = {
      organizationId: input.organizationId,
      appKey,
      actorId: input.actorId,
      returnPath: input.returnPath || '/chat',
    };
    await this.redis.setex(
      `app_oauth:${state}`,
      STATE_TTL,
      JSON.stringify(payload),
    );

    const redirectUri = this.redirectUri();
    const url = new URL(provider.authorizeUrl);
    if (appKey === 'jira') {
      url.searchParams.set('audience', 'api.atlassian.com');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('scope', provider.scopes);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('prompt', 'consent');
    } else if (appKey === 'google-drive') {
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', provider.scopes);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
    } else if (appKey === 'zoom') {
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
    } else {
      // github
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', provider.scopes);
      url.searchParams.set('state', state);
    }

    return { authorizeUrl: url.toString() };
  }

  async handleCallback(input: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    if (input.error) {
      return `${this.frontendUrl()}/chat?integration_error=${encodeURIComponent(input.error)}`;
    }
    const code = String(input.code || '').trim();
    const state = String(input.state || '').trim();
    if (!code || !state) {
      return `${this.frontendUrl()}/chat?integration_error=missing_code`;
    }

    const raw = await this.redis.get(`app_oauth:${state}`);
    await this.redis.del(`app_oauth:${state}`);
    if (!raw) {
      return `${this.frontendUrl()}/chat?integration_error=expired_state`;
    }
    const saved = JSON.parse(raw) as OauthState;
    const appKey = saved.appKey as ProviderKey;
    const provider = PROVIDERS[appKey];
    const clientId = this.config.get<string>(provider.clientIdEnv)!;
    const clientSecret = this.config.get<string>(provider.clientSecretEnv)!;
    const redirectUri = this.redirectUri();

    try {
      const tokens = await this.exchangeCode({
        appKey,
        code,
        clientId,
        clientSecret,
        redirectUri,
      });
      const profile = await this.fetchProfile(appKey, tokens.accessToken);

      await this.proxy.sendChat(
        CHAT_PATTERNS.UPSERT_APP_OAUTH,
        {
          actorId: saved.actorId,
          organizationId: saved.organizationId,
          appKey,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenType: tokens.tokenType ?? 'bearer',
          scopes: tokens.scopes ?? provider.scopes,
          expiresAt: tokens.expiresAt ?? null,
          providerAccountId: profile.id,
          providerAccountName: profile.name,
          meta: profile.meta ?? {},
        } satisfies UpsertAppOauthPayload & { organizationId: string },
      );

      const path = saved.returnPath.startsWith('/')
        ? saved.returnPath
        : `/${saved.returnPath}`;
      return `${this.frontendUrl()}${path}${path.includes('?') ? '&' : '?'}integration_connected=${encodeURIComponent(appKey)}`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'oauth_failed';
      return `${this.frontendUrl()}/chat?integration_error=${encodeURIComponent(message.slice(0, 120))}`;
    }
  }

  private async exchangeCode(input: {
    appKey: ProviderKey;
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scopes?: string;
    expiresAt?: string;
  }> {
    if (input.appKey === 'github') {
      const response = await fetch(PROVIDERS.github.tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      const data = (await response.json()) as {
        access_token?: string;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      };
      if (!data.access_token) {
        throw new Error(data.error_description || data.error || 'GitHub token exchange failed');
      }
      return {
        accessToken: data.access_token,
        scopes: data.scope,
        tokenType: data.token_type,
      };
    }

    if (input.appKey === 'jira') {
      const response = await fetch(PROVIDERS.jira.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      };
      if (!data.access_token) {
        throw new Error(data.error_description || data.error || 'Jira token exchange failed');
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        scopes: data.scope,
        tokenType: data.token_type,
        expiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : undefined,
      };
    }

    if (input.appKey === 'google-drive') {
      const body = new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      });
      const response = await fetch(PROVIDERS['google-drive'].tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      };
      if (!data.access_token) {
        throw new Error(data.error_description || data.error || 'Google token exchange failed');
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        scopes: data.scope,
        tokenType: data.token_type,
        expiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : undefined,
      };
    }

    // zoom
    const basic = Buffer.from(
      `${input.clientId}:${input.clientSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const response = await fetch(PROVIDERS.zoom.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      reason?: string;
      error?: string;
    };
    if (!data.access_token) {
      throw new Error(data.reason || data.error || 'Zoom token exchange failed');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scopes: data.scope,
      tokenType: data.token_type,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined,
    };
  }

  private async fetchProfile(
    appKey: ProviderKey,
    accessToken: string,
  ): Promise<{
    id: string | null;
    name: string | null;
    meta?: Record<string, unknown>;
  }> {
    if (appKey === 'github') {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Relay-Integrations',
        },
      });
      if (!response.ok) return { id: null, name: null };
      const data = (await response.json()) as {
        id?: number;
        login?: string;
      };
      return {
        id: data.id != null ? String(data.id) : null,
        name: data.login ?? null,
        meta: { login: data.login },
      };
    }

    if (appKey === 'jira') {
      const meRes = await fetch('https://api.atlassian.com/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = meRes.ok
        ? ((await meRes.json()) as { account_id?: string; name?: string; email?: string })
        : {};
      const sitesRes = await fetch(
        'https://api.atlassian.com/oauth/token/accessible-resources',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const sites = sitesRes.ok
        ? ((await sitesRes.json()) as Array<{
            id: string;
            name: string;
            url: string;
          }>)
        : [];
      const primary = sites[0];
      return {
        id: me.account_id ?? null,
        name: primary?.name || me.name || me.email || null,
        meta: {
          cloudId: primary?.id,
          siteUrl: primary?.url,
          sites,
        },
      };
    }

    if (appKey === 'google-drive') {
      const response = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) return { id: null, name: null };
      const data = (await response.json()) as {
        id?: string;
        email?: string;
        name?: string;
      };
      return {
        id: data.id ?? null,
        name: data.email || data.name || null,
        meta: { email: data.email },
      };
    }

    const response = await fetch('https://api.zoom.us/v2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { id: null, name: null };
    const data = (await response.json()) as {
      id?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
    };
    return {
      id: data.id ?? null,
      name:
        data.email ||
        [data.first_name, data.last_name].filter(Boolean).join(' ') ||
        null,
      meta: { email: data.email },
    };
  }

  /** Optional helper for signing GitHub webhook secrets comparisons. */
  static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
