import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<boolean>('SMTP_SECURE', false),
        auth: {
          user: this.config.get<string>('SMTP_USER', ''),
          pass: this.config.get<string>('SMTP_PASS', ''),
        },
      });
      this.logger.log(`SMTP mailer ready (${host})`);
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

  async send(input: SendMailInput): Promise<{ delivered: boolean; previewUrl?: string }> {
    if (!this.transporter) {
      this.logger.log(
        `[mail:dev] to=${input.to} subject=${input.subject}\n${input.text}`,
      );
      return { delivered: false, previewUrl: this.extractUrl(input.text) };
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { delivered: true };
  }

  private extractUrl(text: string): string | undefined {
    const match = text.match(/https?:\/\/\S+/);
    return match?.[0];
  }
}
