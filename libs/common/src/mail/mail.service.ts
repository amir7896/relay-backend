import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function parseBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
}

function parsePort(value: unknown, fallback = 587): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const port = parsePort(this.config.get('SMTP_PORT'), 587);
      // Env strings like "false" are truthy in JS — always coerce explicitly.
      // Port 465 = implicit TLS; 587/25 = plain then STARTTLS.
      const secure =
        this.config.get('SMTP_SECURE') === undefined ||
        this.config.get('SMTP_SECURE') === ''
          ? port === 465
          : parseBool(this.config.get('SMTP_SECURE'), port === 465);
      const user = (this.config.get<string>('SMTP_USER') || '').trim();
      // Gmail app passwords are often pasted with spaces.
      const pass = (this.config.get<string>('SMTP_PASS') || '').replace(
        /\s+/g,
        '',
      );

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure && port === 587,
        auth: user ? { user, pass } : undefined,
      });
      this.logger.log(
        `SMTP mailer ready (${host}:${port}, secure=${secure}, requireTLS=${!secure && port === 587})`,
      );
    } else {
      this.logger.warn(
        'SMTP_HOST not set — auth emails will be logged (dev mode)',
      );
    }
  }

  get publicAppUrl(): string {
    return (
      this.config.get<string>('APP_PUBLIC_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'http://127.0.0.1:5173'
    ).replace(/\/$/, '');
  }

  get fromAddress(): string {
    return (
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      'Relay <noreply@relay.local>'
    );
  }

  async send(
    input: SendMailInput,
  ): Promise<{ delivered: boolean; previewUrl?: string }> {
    if (!this.transporter) {
      this.logger.warn(
        `Email NOT sent (SMTP not configured) | to=${input.to} | subject="${input.subject}"`,
      );
      this.logger.log(`[mail:dev] body preview:\n${input.text}`);
      return { delivered: false, previewUrl: this.extractUrl(input.text) };
    }

    this.logger.log(
      `Sending email | to=${input.to} | from=${this.fromAddress} | subject="${input.subject}"`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      const messageId = info.messageId ?? 'n/a';
      const accepted = Array.isArray(info.accepted)
        ? info.accepted.join(', ')
        : String(info.accepted ?? '');
      const rejected = Array.isArray(info.rejected)
        ? info.rejected.join(', ')
        : String(info.rejected ?? '');
      const response =
        typeof info.response === 'string' ? info.response : undefined;

      if (rejected) {
        this.logger.warn(
          `Email rejected by SMTP | to=${input.to} | messageId=${messageId} | rejected=${rejected} | response=${response ?? 'n/a'}`,
        );
        return { delivered: false, previewUrl: this.extractUrl(input.text) };
      }

      this.logger.log(
        `Email SENT successfully | to=${input.to} | messageId=${messageId} | accepted=${accepted || 'n/a'}${response ? ` | smtp=${response}` : ''}`,
      );
      return { delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Email FAILED to send | to=${input.to} | subject="${input.subject}" | error=${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { delivered: false, previewUrl: this.extractUrl(input.text) };
    }
  }

  private extractUrl(text: string): string | undefined {
    const match = text.match(/https?:\/\/\S+/);
    return match?.[0];
  }
}
