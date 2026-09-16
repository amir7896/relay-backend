import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import Redis from 'ioredis';
import {
  BadRequestAppException,
  ForbiddenAppException,
  REDIS_CLIENT,
} from '@app/common';
import { AUTH_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type { AuthResult, OrgSsoCredentialsView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { AuthSessionCache } from './auth-session.cache';
import { AuditLoggerService } from '../infrastructure/audit/audit-logger.service';

type SamlStatePayload = {
  organizationId: string;
  returnPath: string;
};

const STATE_TTL_SECONDS = 600;
const PAID_PLANS = new Set(['pro', 'enterprise']);

@Injectable()
export class SsoSamlService {
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

  spEntityId(organizationId: string): string {
    return `${this.apiPublicUrl()}/auth/sso/saml/${organizationId}`;
  }

  acsUrl(organizationId: string): string {
    return `${this.apiPublicUrl()}/auth/sso/saml/${organizationId}/acs`;
  }

  metadataUrl(organizationId: string): string {
    return `${this.apiPublicUrl()}/auth/sso/saml/${organizationId}/metadata`;
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

  private normalizeCertificate(raw: string): string {
    let cert = raw.trim().replace(/\\n/g, '\n');
    if (!cert.includes('BEGIN CERTIFICATE')) {
      const body = cert.replace(/\s+/g, '');
      cert = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END CERTIFICATE-----`;
    }
    return cert;
  }

  private buildClient(credentials: OrgSsoCredentialsView): SAML {
    if (!credentials.ssoIdpSsoUrl || !credentials.ssoIdpCertificate) {
      throw new BadRequestAppException(
        'SAML IdP SSO URL and certificate are required',
      );
    }
    return new SAML({
      callbackUrl: this.acsUrl(credentials.organizationId),
      entryPoint: credentials.ssoIdpSsoUrl,
      issuer: this.spEntityId(credentials.organizationId),
      idpCert: this.normalizeCertificate(credentials.ssoIdpCertificate),
      // Prefer signed assertions; many IdPs sign Response or Assertion.
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.never,
      acceptedClockSkewMs: 5 * 60 * 1000,
    });
  }

  async buildAuthorizationRedirect(input: {
    organizationId?: string;
    slug?: string;
    returnPath?: string;
  }): Promise<string> {
    const credentials = await this.resolveCredentials(input);
    if (!credentials.configured || credentials.ssoProvider !== 'saml') {
      throw new BadRequestAppException(
        'SAML SSO is not fully configured for this workspace',
      );
    }
    if (!PAID_PLANS.has(credentials.plan)) {
      throw new ForbiddenAppException(
        'SSO requires a Pro or Enterprise plan',
      );
    }

    const returnPath =
      input.returnPath &&
      input.returnPath.startsWith('/') &&
      !input.returnPath.startsWith('//')
        ? input.returnPath
        : '/chat';

    const relayState = randomBytes(24).toString('hex');
    const payload: SamlStatePayload = {
      organizationId: credentials.organizationId,
      returnPath,
    };
    await this.redis.set(
      this.stateKey(relayState),
      JSON.stringify(payload),
      'EX',
      STATE_TTL_SECONDS,
    );

    const saml = this.buildClient(credentials);
    return saml.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  async handleAcs(input: {
    organizationId: string;
    body: Record<string, string>;
    ip?: string;
    userAgent?: string;
  }): Promise<{ redirectUrl: string }> {
    const credentials = await this.resolveCredentials({
      organizationId: input.organizationId,
    });
    if (!credentials.configured || credentials.ssoProvider !== 'saml') {
      throw new BadRequestAppException(
        'SAML SSO is not fully configured for this workspace',
      );
    }
    if (!PAID_PLANS.has(credentials.plan)) {
      throw new ForbiddenAppException(
        'SSO requires a Pro or Enterprise plan',
      );
    }

    const relayState = String(input.body.RelayState || '').trim();
    let returnPath = '/chat';
    if (relayState) {
      const rawState = await this.redis.get(this.stateKey(relayState));
      await this.redis.del(this.stateKey(relayState));
      if (rawState) {
        const state = JSON.parse(rawState) as SamlStatePayload;
        if (state.organizationId !== input.organizationId) {
          throw new BadRequestAppException('SAML RelayState org mismatch');
        }
        returnPath = state.returnPath || '/chat';
      }
    }

    const saml = this.buildClient(credentials);
    let profile: Record<string, unknown> | null = null;
    try {
      const result = await saml.validatePostResponseAsync(input.body);
      if (result.loggedOut) {
        return { redirectUrl: `${this.frontendUrl()}/login` };
      }
      profile = (result.profile ?? null) as Record<string, unknown> | null;
    } catch (error) {
      const message = encodeURIComponent(
        error instanceof Error ? error.message : 'SAML assertion invalid',
      );
      return {
        redirectUrl: `${this.frontendUrl()}/login?ssoError=${message}`,
      };
    }

    if (!profile) {
      throw new BadRequestAppException('SAML response missing profile');
    }

    const email = this.extractEmail(profile);
    if (!email) {
      throw new BadRequestAppException(
        'SAML assertion missing email / NameID',
      );
    }

    const firstName = this.pickAttr(profile, [
      'givenName',
      'firstName',
      'first_name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    ]);
    const lastName = this.pickAttr(profile, [
      'surname',
      'lastName',
      'last_name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    ]);
    const displayName = this.pickAttr(profile, [
      'displayName',
      'name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    ]);

    const result = await this.proxy.sendAuth<AuthResult>(
      AUTH_PATTERNS.SSO_COMPLETE,
      {
        organizationId: input.organizationId,
        email,
        emailVerified: true,
        firstName: (firstName || displayName || 'SSO').slice(0, 80),
        lastName: (lastName || 'User').slice(0, 80),
        ip: input.ip,
        userAgent: input.userAgent,
      },
      { skipTenant: true },
    );

    await this.sessionCache.set(result.user);
    this.audit.log({
      actorId: result.user.id,
      organizationId: input.organizationId,
      action: 'auth.login',
      targetType: 'user',
      targetId: result.user.id,
      meta: { method: 'sso_saml' },
    });
    try {
      await this.proxy.sendUser(
        USER_PATTERNS.CREATE_PROFILE,
        {
          userId: result.user.id,
          email: result.user.email,
          firstName: (firstName || displayName || 'SSO').slice(0, 80) || 'SSO',
          lastName: (lastName || 'User').slice(0, 80) || 'User',
          organizationId: input.organizationId,
        },
        { skipTenant: true },
      );
    } catch {
      // Profile may already exist
    }

    const params = new URLSearchParams({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      organizationId: input.organizationId,
      returnPath,
    });
    return {
      redirectUrl: `${this.frontendUrl()}/sso/callback?${params.toString()}`,
    };
  }

  async getServiceProviderMetadata(organizationId: string): Promise<string> {
    const credentials = await this.resolveCredentials({ organizationId });
    if (credentials.ssoProvider !== 'saml') {
      throw new BadRequestAppException(
        'Workspace SSO provider is not SAML',
      );
    }
    // Metadata generation does not require a valid IdP cert; use a placeholder
    // when the cert is not configured yet so admins can still download SP XML.
    const idpCert =
      credentials.ssoIdpCertificate?.trim() ||
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const saml = new SAML({
      callbackUrl: this.acsUrl(organizationId),
      entryPoint: credentials.ssoIdpSsoUrl || 'https://idp.example/sso',
      issuer: this.spEntityId(organizationId),
      idpCert: this.normalizeCertificate(idpCert),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
    });
    return saml.generateServiceProviderMetadata(null, null);
  }

  private extractEmail(profile: Record<string, unknown>): string | null {
    const candidates = [
      profile.email,
      profile.mail,
      profile.nameID,
      profile[
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      ],
      profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    ];
    for (const value of candidates) {
      const email = this.asEmail(value);
      if (email) return email;
    }
    return null;
  }

  private pickAttr(
    profile: Record<string, unknown>,
    keys: string[],
  ): string {
    for (const key of keys) {
      const value = profile[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0].trim();
      }
    }
    return '';
  }

  private asEmail(value: unknown): string | null {
    if (typeof value === 'string') {
      const email = value.toLowerCase().trim();
      if (email.includes('@')) return email;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
      const email = value[0].toLowerCase().trim();
      if (email.includes('@')) return email;
    }
    return null;
  }

  private stateKey(state: string): string {
    return `sso:saml:state:${state}`;
  }

  /** Stable fingerprint for debugging (not security-sensitive). */
  static fingerprint(cert: string): string {
    return createHash('sha256').update(cert).digest('hex').slice(0, 12);
  }
}
