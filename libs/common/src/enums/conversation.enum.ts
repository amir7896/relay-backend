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
}

export enum PresenceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
}

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number];
