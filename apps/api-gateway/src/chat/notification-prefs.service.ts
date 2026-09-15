import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@app/common';
import type Redis from 'ioredis';

export type NotificationMode = 'all' | 'mentions' | 'none';

export type NotificationPrefs = {
  mode: NotificationMode;
  quietHoursEnabled: boolean;
  /** HH:mm in the user's timezone */
  quietStart: string;
  /** HH:mm in the user's timezone */
  quietEnd: string;
  /** IANA timezone, e.g. Asia/Karachi */
  timezone: string;
  /** Suppress message push when Away / Busy / DND is set */
  respectStatus: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  mode: 'all',
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timezone: 'UTC',
  respectStatus: true,
};

@Injectable()
export class NotificationPrefsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(userId: string): Promise<NotificationPrefs> {
    const raw = await this.redis.get(this.key(userId));
    if (!raw) {
      return { ...DEFAULT_NOTIFICATION_PREFS };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
      return this.normalize(parsed);
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFS };
    }
  }

  async set(
    userId: string,
    patch: Partial<NotificationPrefs>,
  ): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    const next = this.normalize({ ...current, ...patch });
    await this.redis.set(this.key(userId), JSON.stringify(next));
    return next;
  }

  /** True when local clock in prefs.timezone falls inside quiet hours window. */
  isInQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
    if (!prefs.quietHoursEnabled) {
      return false;
    }
    const start = this.parseHm(prefs.quietStart);
    const end = this.parseHm(prefs.quietEnd);
    if (start === null || end === null) {
      return false;
    }
    const minutes = this.localMinutes(now, prefs.timezone);
    if (minutes === null) {
      return false;
    }
    // Window that does not cross midnight (e.g. 09:00–17:00)
    if (start <= end) {
      return minutes >= start && minutes < end;
    }
    // Overnight window (e.g. 22:00–08:00)
    return minutes >= start || minutes < end;
  }

  private normalize(input: Partial<NotificationPrefs>): NotificationPrefs {
    const mode =
      input.mode === 'mentions' || input.mode === 'none' || input.mode === 'all'
        ? input.mode
        : DEFAULT_NOTIFICATION_PREFS.mode;
    return {
      mode,
      quietHoursEnabled: Boolean(input.quietHoursEnabled),
      quietStart: this.validHm(input.quietStart)
        ? input.quietStart!
        : DEFAULT_NOTIFICATION_PREFS.quietStart,
      quietEnd: this.validHm(input.quietEnd)
        ? input.quietEnd!
        : DEFAULT_NOTIFICATION_PREFS.quietEnd,
      timezone:
        typeof input.timezone === 'string' && input.timezone.trim()
          ? input.timezone.trim().slice(0, 64)
          : DEFAULT_NOTIFICATION_PREFS.timezone,
      respectStatus:
        input.respectStatus === undefined
          ? DEFAULT_NOTIFICATION_PREFS.respectStatus
          : Boolean(input.respectStatus),
    };
  }

  private validHm(value: string | undefined): value is string {
    return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
  }

  private parseHm(value: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  private localMinutes(now: Date, timeZone: string): number | null {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return null;
      }
      // en-GB may yield 24:00 at midnight in some engines
      const h = hour === 24 ? 0 : hour;
      return h * 60 + minute;
    } catch {
      return null;
    }
  }

  private key(userId: string): string {
    return `chat:notify:prefs:${userId}`;
  }
}
