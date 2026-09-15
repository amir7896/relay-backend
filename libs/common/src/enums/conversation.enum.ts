export enum ConversationType {
  PRIVATE = 'private',
  GROUP = 'group',
}

export enum ConversationMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  AUDIO = 'audio',
  /** System call history line (JSON body). */
  CALL = 'call',
  /** Interactive poll card. */
  POLL = 'poll',
}

export enum PresenceStatus {
  ONLINE = 'online',
  AWAY = 'away',
  BUSY = 'busy',
  DND = 'dnd',
  OFFLINE = 'offline',
}

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number];

/** Suggested quick-bar reactions (UI); any valid emoji may be stored. */
export const QUICK_REACTIONS = ALLOWED_REACTIONS;

const CUSTOM_SHORTCODE = /^:[a-z0-9_+-]{1,32}:$/i;

/**
 * Accept Unicode emoji (incl. ZWJ / skin tones) or `:custom_shortcode:`.
 * Reject empty, whitespace, URLs, and plain alphanumeric labels.
 */
export function isValidReactionEmoji(value: string): boolean {
  const emoji = value.trim();
  if (!emoji || emoji.length > 64) {
    return false;
  }
  if (/\s/.test(emoji) || /^https?:\/\//i.test(emoji)) {
    return false;
  }
  if (CUSTOM_SHORTCODE.test(emoji)) {
    return true;
  }
  if (/^[a-zA-Z0-9._+-]+$/.test(emoji)) {
    return false;
  }
  try {
    const Segmenter = (
      Intl as unknown as {
        Segmenter?: new (
          locales?: string | string[],
          options?: { granularity?: string },
        ) => { segment: (input: string) => Iterable<{ segment: string }> };
      }
    ).Segmenter;
    if (Segmenter) {
      const segments = [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
      return segments.length >= 1 && segments.length <= 8;
    }
  } catch {
    // fall through
  }
  return [...emoji].length <= 24;
}
