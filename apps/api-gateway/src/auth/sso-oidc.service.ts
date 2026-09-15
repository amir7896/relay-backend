import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  REDIS_CLIENT,
} from '@app/common';
import { AUTH_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  AuthResult,
  OrgSsoCredentialsView,
} from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { AuthSessionCache } from './auth-session.cache';
import { AuditLoggerService } from '../infrastructure/audit/audit-logger.service';

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  issuer: string;
};

type SsoStatePayload = {
  organizationId: string;
  nonce: string;
  codeVerifier: string;
  returnPath: string;
};

const STATE_TTL_SECONDS = 600;
const PAID_PLANS = new Set(['pro', 'enterprise']);

@Injectable()
export class SsoOidcService {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly config: ConfigService,
    private readonly sessionCache: AuthSessionCache,
    private readonly audit: AuditLoggerService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL')?.replace(/\/$/, '') ||
      'http://localhost:5173'
    );
  }

  private apiPublicUrl(): string {
    return (
      this.config.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.config.get<number>('PORT', 3002)}/api`
    );
  }

  private redirectUri(): string {
    return `${this.apiPublicUrl()}/auth/sso/callback`;
  }

  async resolveCredentials(input: {
    organizationId?: string;
    slug?: string;
  }): Promise<OrgSsoCredentialsView> {
    return this.proxy.sendAuth<OrgSsoCredentialsView>(
      AUTH_PATTERNS.GET_ORG_SSO_CREDENTIALS,
      input,
      { skipTenant: true },
    );
  }

  async buildAuthorizationRedirect(input: {
    organizationId?: string;
    slug?: string;
    returnPath?: string;
  }): Promise<string> {
    const credentials = await this.resolveCredentials(input);
    if (!credentials.configured || credentials.ssoProvider !== 'oidc') {
      throw new BadRequestAppException(
        'OIDC SSO is not fully configured for this workspace',
      );
    }
    if (!PAID_PLANS.has(credentials.plan)) {
      throw new ForbiddenAppException(
        'SSO requires a Pro or Enterprise plan',
      );
    }
    if (!credentials.ssoIssuerUrl || !credentials.ssoClientId) {
      throw new BadRequestAppException('SSO issuer and client id are required');
    }
    if (!credentials.ssoClientSecret) {
      throw new BadRequestAppException('SSO client secret is required');
    }

    const discovery = await this.discover(credentials.ssoIssuerUrl);
    if (!discovery.jwks_uri) {
      throw new BadRequestAppException(
        'OIDC discovery document is missing jwks_uri',
      );
    }
    const state = randomBytes(24).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const returnPath =
      input.returnPath &&
      input.returnPath.startsWith('/') &&
      !input.returnPath.startsWith('//')
        ? input.returnPath
        : '/chat';

    const payload: SsoStatePayload = {
      organizationId: credentials.organizationId,
      nonce,
      codeVerifier,
      returnPath,
    };
    await this.redis.set(
      this.stateKey(state),
      JSON.stringify(payload),
      'EX',
      STATE_TTL_SECONDS,
    );

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', credentials.ssoClientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async handleCallback(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ redirectUrl: string }> {
    if (input.error) {
      const message = encodeURIComponent(
        input.errorDescription || input.error || 'SSO failed',
      );
      return {
        redirectUrl: `${this.frontendUrl()}/login?ssoError=${message}`,
      };
    }
    if (!input.code?.trim() || !input.state?.trim()) {
      throw new BadRequestAppException('Missing OIDC code or state');
    }

    const rawState = await this.redis.get(this.stateKey(input.state));
    await this.redis.del(this.stateKey(input.state));
    if (!rawState) {
      throw new BadRequestAppException('SSO state expired or invalid');
    }
    const state = JSON.parse(rawState) as SsoStatePayload;

    const credentials = await this.resolveCredentials({
      organizationId: state.organizationId,
    });
    if (!credentials.ssoClientId || !credentials.ssoClientSecret) {
      throw new ForbiddenAppException('SSO credentials missing');
    }
    if (!PAID_PLANS.has(credentials.plan)) {
      throw new ForbiddenAppException(
        'SSO requires a Pro or Enterprise plan',
      );
    }
    const discovery = await this.discover(credentials.ssoIssuerUrl!);
    if (!discovery.jwks_uri) {
      throw new BadRequestAppException(
        'OIDC discovery document is missing jwks_uri',
      );
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: this.redirectUri(),
      client_id: credentials.ssoClientId,
      client_secret: credentials.ssoClientSecret,
      code_verifier: state.codeVerifier,
    });

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new BadRequestAppException(
        `OIDC token exchange failed: ${text.slice(0, 200)}`,
      );
    }
    const tokenJson = (await tokenRes.json()) as {
      id_token?: string;
      access_token?: string;
    };
    if (!tokenJson.id_token) {
      throw new BadRequestAppException('OIDC response missing id_token');
    }

    const claims = await this.verifyIdToken({
      idToken: tokenJson.id_token,
      jwksUri: discovery.jwks_uri,
      issuer: discovery.issuer || credentials.ssoIssuerUrl!,
      clientId: credentials.ssoClientId,
      expectedNonce: state.nonce,
    });

    const email = String(claims.email ?? '').toLowerCase().trim();
    if (!email) {
      throw new BadRequestAppException('OIDC id_token missing email claim');
    }
    if (claims.email_verified === false) {
      throw new ForbiddenAppException('SSO email is not verified at the IdP');
    }

    const result = await this.proxy.sendAuth<AuthResult>(
      AUTH_PATTERNS.SSO_COMPLETE,
      {
        organizationId: state.organizationId,
        email,
        emailVerified: claims.email_verified !== false,
        firstName: String(claims.given_name ?? claims.name ?? '').slice(0, 80),
        lastName: String(claims.family_name ?? '').slice(0, 80),
        ip: input.ip,
        userAgent: input.userAgent,
      },
      { skipTenant: true },
    );

    await this.sessionCache.set(result.user);
    this.audit.log({
      actorId: result.user.id,
      organizationId: state.organizationId,
      action: 'auth.login',
      targetType: 'user',
      targetId: result.user.id,
      meta: { method: 'sso_oidc' },
    });
    try {
      await this.proxy.sendUser(
        USER_PATTERNS.CREATE_PROFILE,
        {
          userId: result.user.id,
          email: result.user.email,
          firstName: String(claims.given_name ?? 'SSO').slice(0, 80) || 'SSO',
          lastName: String(claims.family_name ?? 'User').slice(0, 80) || 'User',
          organizationId: state.organizationId,
        },
        { skipTenant: true },
      );
    } catch {
      // Profile may already exist
    }

    const params = new URLSearchParams({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      organizationId: state.organizationId,
      returnPath: state.returnPath,
    });
    return {
      redirectUrl: `${this.frontendUrl()}/sso/callback?${params.toString()}`,
    };
  }

  private stateKey(state: string) {
    return `sso:oidc:state:${state}`;
  }

  private async discover(issuerUrl: string): Promise<OidcDiscovery> {
    const base = issuerUrl.replace(/\/$/, '');
    const wellKnown = `${base}/.well-known/openid-configuration`;
    let res: Response;
    try {
      res = await fetch(wellKnown);
    } catch {
      throw new BadRequestAppException(
        'Could not reach OIDC discovery endpoint',
      );
    }
    if (!res.ok) {
      throw new NotFoundAppException('OIDC discovery document');
    }
    const json = (await res.json()) as OidcDiscovery;
    if (!json.authorization_endpoint || !json.token_endpoint) {
      throw new BadRequestAppException('Invalid OIDC discovery document');
    }
    return json;
  }

  /**
   * Cryptographically verify id_token (signature + iss/aud/exp/nonce)
   * using the IdP JWKS — never trust an unverified JWT payload.
   */
  private async verifyIdToken(input: {
    idToken: string;
    jwksUri: string;
    issuer: string;
    clientId: string;
    expectedNonce: string;
  }): Promise<JWTPayload & Record<string, unknown>> {
    try {
      const issuerCandidates = [
        ...new Set(
          [
            input.issuer,
            input.issuer.replace(/\/$/, ''),
            `${input.issuer.replace(/\/$/, '')}/`,
          ].filter(Boolean),
        ),
      ];
      const jwks = createRemoteJWKSet(new URL(input.jwksUri));
      const { payload } = await jwtVerify(input.idToken, jwks, {
        issuer: issuerCandidates,
        audience: input.clientId,
        clockTolerance: 60,
      });

      const nonce = payload.nonce;
      if (typeof nonce === 'string' && nonce !== input.expectedNonce) {
        throw new BadRequestAppException('OIDC nonce mismatch');
      }
      if (nonce == null) {
        // Some IdPs omit nonce when not requested; we always send it — require it.
        throw new BadRequestAppException('OIDC id_token missing nonce');
      }

      return payload as JWTPayload & Record<string, unknown>;
    } catch (error) {
      if (
        error instanceof BadRequestAppException ||
        error instanceof ForbiddenAppException
      ) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'id_token verification failed';
      throw new BadRequestAppException(
        `OIDC id_token verification failed: ${message.slice(0, 200)}`,
      );
    }
  }
}
