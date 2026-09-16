import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@app/common';
import type Redis from 'ioredis';

export type NotificationMode = 'all' | 'mentions' | 'none';
export type ChannelNotifyMode = 'default' | 'all' | 'mentions' | 'none';

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
  /** Case-insensitive keyword / phrase highlights */
  keywords: string[];
  /**
   * Per-conversation overrides. Missing key (or 'default') uses global `mode`.
   * Only non-default modes are stored.
   */
  channels: Record<string, Exclude<ChannelNotifyMode, 'default'>>;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  mode: 'all',
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timezone: 'UTC',
  respectStatus: true,
  keywords: [],
  channels: {},
};

const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 40;
const MAX_CHANNEL_OVERRIDES = 500;

@Injectable()
export class NotificationPrefsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(userId: string): Promise<NotificationPrefs> {
    const raw = await this.redis.get(this.key(userId));
    if (!raw) {
      return { ...DEFAULT_NOTIFICATION_PREFS, channels: {} };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
      return this.normalize(parsed);
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFS, channels: {} };
    }
  }

  async set(
    userId: string,
    patch: Omit<Partial<NotificationPrefs>, 'channels'> & {
      channels?: Record<string, ChannelNotifyMode>;
    },
  ): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    const next = this.normalize({
      ...current,
      ...patch,
      channels:
        patch.channels !== undefined
          ? this.mergeChannels(current.channels, patch.channels)
          : current.channels,
      keywords:
        patch.keywords !== undefined ? patch.keywords : current.keywords,
    });
    await this.redis.set(this.key(userId), JSON.stringify(next));
    return next;
  }

  async getChannelMode(
    userId: string,
    conversationId: string,
  ): Promise<ChannelNotifyMode> {
    const prefs = await this.get(userId);
    return prefs.channels[conversationId] ?? 'default';
  }

  async setChannelMode(
    userId: string,
    conversationId: string,
    mode: ChannelNotifyMode,
  ): Promise<{ conversationId: string; mode: ChannelNotifyMode }> {
    const normalized: ChannelNotifyMode =
      mode === 'all' || mode === 'mentions' || mode === 'none' || mode === 'default'
        ? mode
        : 'default';
    await this.set(userId, {
      channels: { [conversationId]: normalized },
    });
    return { conversationId, mode: normalized };
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
    if (start <= end) {
      return minutes >= start && minutes < end;
    }
    return minutes >= start || minutes < end;
  }

  resolveEffectiveMode(
    prefs: NotificationPrefs,
    conversationId: string,
  ): NotificationMode {
    const override = prefs.channels[conversationId];
    if (override === 'all' || override === 'mentions' || override === 'none') {
      return override;
    }
    return prefs.mode;
  }

  matchesKeyword(body: string | null | undefined, keywords: string[]): boolean {
    const text = String(body || '').toLowerCase();
    if (!text || !keywords.length) {
      return false;
    }
    return keywords.some((keyword) => {
      const needle = keyword.toLowerCase();
      if (!needle) return false;
      if (needle.includes(' ')) {
        return text.includes(needle);
      }
      // Whole-word match for single tokens (avoid "cat" in "concatenate")
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(
        text,
      );
    });
  }

  /**
   * Shared decision for desktop + push notifications.
   * Mentions and keyword highlights break through mute / mentions-only / quiet hours.
   */
  shouldNotifyMessage(
    prefs: NotificationPrefs,
    input: {
      conversationId: string;
      mentionsMe: boolean;
      muted?: boolean;
      body?: string | null;
      myStatus?: 'online' | 'away' | 'busy' | 'dnd' | 'offline' | string | null;
    },
  ): { notify: boolean; matchedKeyword: boolean } {
    const matchedKeyword = this.matchesKeyword(input.body, prefs.keywords);
    const isHighlight = input.mentionsMe || matchedKeyword;
    const effective = this.resolveEffectiveMode(prefs, input.conversationId);

    if (input.muted && !isHighlight) {
      return { notify: false, matchedKeyword };
    }
    if (effective === 'none' && !isHighlight) {
      return { notify: false, matchedKeyword };
    }
    if (effective === 'mentions' && !isHighlight) {
      return { notify: false, matchedKeyword };
    }
    if (this.isInQuietHours(prefs) && !isHighlight) {
      return { notify: false, matchedKeyword };
    }
    if (prefs.respectStatus) {
      const status = input.myStatus;
      if (status === 'dnd' || status === 'busy') {
        return { notify: false, matchedKeyword };
      }
      if (status === 'away' && !isHighlight) {
        return { notify: false, matchedKeyword };
      }
    }
    return { notify: true, matchedKeyword };
  }

  private mergeChannels(
    current: Record<string, Exclude<ChannelNotifyMode, 'default'>>,
    patch: Record<string, ChannelNotifyMode>,
  ): Record<string, Exclude<ChannelNotifyMode, 'default'>> {
    const next = { ...current };
    for (const [conversationId, mode] of Object.entries(patch)) {
      if (!conversationId || conversationId.length > 64) continue;
      if (mode === 'default') {
        delete next[conversationId];
      } else if (mode === 'all' || mode === 'mentions' || mode === 'none') {
        next[conversationId] = mode;
      }
    }
    const entries = Object.entries(next);
    if (entries.length <= MAX_CHANNEL_OVERRIDES) {
      return next;
    }
    return Object.fromEntries(entries.slice(-MAX_CHANNEL_OVERRIDES));
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
      keywords: this.normalizeKeywords(input.keywords),
      channels: this.normalizeChannels(input.channels),
    };
  }

  private normalizeKeywords(input: unknown): string[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of input) {
      if (typeof raw !== 'string') continue;
      const value = raw.trim().slice(0, MAX_KEYWORD_LENGTH);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= MAX_KEYWORDS) break;
    }
    return out;
  }

  private normalizeChannels(
    input: unknown,
  ): Record<string, Exclude<ChannelNotifyMode, 'default'>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    const out: Record<string, Exclude<ChannelNotifyMode, 'default'>> = {};
    for (const [conversationId, mode] of Object.entries(
      input as Record<string, unknown>,
    )) {
      if (
        typeof conversationId !== 'string' ||
        !conversationId ||
        conversationId.length > 64
      ) {
        continue;
      }
      if (mode === 'all' || mode === 'mentions' || mode === 'none') {
        out[conversationId] = mode;
      }
    }
    return out;
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
