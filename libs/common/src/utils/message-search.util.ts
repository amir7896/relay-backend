export type SearchHasKind = 'file' | 'image' | 'link' | 'audio';

export type ParsedMessageSearch = {
  /** Free-text terms after operators are stripped. */
  text: string;
  /** from:alice / from:uuid tokens (lowercase, # stripped). */
  fromTokens: string[];
  /** in:general / in:#eng channel name tokens (lowercase, # stripped). */
  inChannels: string[];
  /** has:file|image|link|audio */
  has: SearchHasKind[];
  before?: Date;
  after?: Date;
};

const OPERATOR_RE =
  /\b(from|in|has|before|after):(?:"([^"]+)"|(\S+))/gi;

const HAS_KINDS = new Set<SearchHasKind>([
  'file',
  'image',
  'link',
  'audio',
]);

function parseDateToken(raw: string): Date | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  const lower = value.toLowerCase();
  const now = Date.now();
  if (lower === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (lower === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const relative = lower.match(/^(\d+)\s*(d|day|days|w|week|weeks)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms = unit.startsWith('w')
      ? amount * 7 * 86_400_000
      : amount * 86_400_000;
    return new Date(now - ms);
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed);
  }
  return undefined;
}

/**
 * Slack-style message search operators:
 * - from:jane / from:uuid
 * - in:general / in:#eng
 * - has:file|image|link|audio
 * - before:2024-01-01 / after:7d / after:yesterday
 */
export function parseMessageSearchQuery(input: string): ParsedMessageSearch {
  const raw = input.trim();
  const fromTokens: string[] = [];
  const inChannels: string[] = [];
  const has: SearchHasKind[] = [];
  let before: Date | undefined;
  let after: Date | undefined;

  const stripped = raw.replace(OPERATOR_RE, (_match, key, quoted, bare) => {
    const token = String(quoted ?? bare ?? '')
      .trim()
      .replace(/^#/, '');
    if (!token) {
      return ' ';
    }
    const op = String(key).toLowerCase();
    if (op === 'from') {
      fromTokens.push(token.toLowerCase());
    } else if (op === 'in') {
      inChannels.push(token.toLowerCase());
    } else if (op === 'has') {
      const kind = token.toLowerCase() as SearchHasKind;
      if (HAS_KINDS.has(kind) && !has.includes(kind)) {
        has.push(kind);
      }
    } else if (op === 'before') {
      before = parseDateToken(token) ?? before;
    } else if (op === 'after') {
      after = parseDateToken(token) ?? after;
    }
    return ' ';
  });

  const text = stripped.replace(/\s+/g, ' ').trim();

  return {
    text,
    fromTokens,
    inChannels,
    has,
    before,
    after,
  };
}

/** Build a safe Postgres tsquery from free text (prefix-friendly). */
export function buildTsQuery(text: string): string | null {
  const terms = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `${term}:*`).join(' & ');
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function isUuidToken(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
