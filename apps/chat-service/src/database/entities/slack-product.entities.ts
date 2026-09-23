import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'channel_canvases' })
@Index(['organizationId', 'conversationId'], { unique: true })
export class ChannelCanvas {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column({ type: 'varchar', length: 160, default: '' }) title!: string;
  @Column({ type: 'text', default: '' }) body!: string;
  /** Base64 Yjs document state for CRDT collaborative editing. */
  @Column({ type: 'text', nullable: true }) ydocState!: string | null;
  @Column('uuid') updatedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'channel_whiteboards' })
@Index(['organizationId', 'conversationId'], { unique: true })
export class ChannelWhiteboard {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  /** Base64 Yjs document state (strokes + sticky notes). */
  @Column({ type: 'text', nullable: true }) ydocState!: string | null;
  @Column('uuid') updatedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'channel_lists' })
export class ChannelList {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column('uuid') createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'channel_list_items' })
export class ChannelListItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') listId!: string;
  @Column({ type: 'varchar', length: 500 }) title!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ type: 'varchar', length: 16, default: 'todo' }) status!: 'todo' | 'doing' | 'done';
  @Column({ type: 'varchar', length: 16, default: 'medium' })
  priority!: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  @Column({ type: 'jsonb', default: [] }) labels!: string[];
  @Column({ type: 'int', nullable: true }) estimate!: number | null;
  @Column({ type: 'uuid', nullable: true }) parentItemId!: string | null;
  @Column({ type: 'uuid', nullable: true }) assigneeId!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) dueAt!: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) dueRemindedAt!: Date | null;
  @Column({ type: 'int', default: 0 }) sortOrder!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'channel_list_item_comments' })
export class ChannelListItemComment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column('uuid') listId!: string;
  @Column('uuid') itemId!: string;
  @Column('uuid') authorId!: string;
  @Column({ type: 'varchar', length: 4000 }) body!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'channel_clips' })
export class ChannelClip {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column({ type: 'uuid', nullable: true }) messageId!: string | null;
  @Column('uuid') createdBy!: string;
  @Column({ type: 'varchar', length: 1000 }) mediaUrl!: string;
  @Column({ type: 'varchar', length: 16 }) mediaType!: 'audio' | 'video';
  @Column({ type: 'int', nullable: true }) durationSeconds!: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'channel_huddles' })
export class ChannelHuddle {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!: 'active' | 'ended';
  @Column('uuid') startedBy!: string;
  @Column({ type: 'jsonb', default: [] }) participantIds!: string[];
  @CreateDateColumn({ type: 'timestamptz' }) startedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt!: Date | null;
}

@Entity({ name: 'channel_workflows' })
export class ChannelWorkflow {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column({ type: 'uuid', nullable: true }) conversationId!: string | null;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @Column({ type: 'varchar', length: 32 }) triggerType!: string;
  @Column({ type: 'jsonb', default: {} }) triggerConfig!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 32 }) actionType!: string;
  @Column({ type: 'jsonb', default: {} }) actionConfig!: Record<string, unknown>;
  @Column('uuid') createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'shared_channel_invites' })
export class SharedChannelInvite {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column({ type: 'varchar', length: 320 }) email!: string;
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 }) token!: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!: 'pending' | 'accepted' | 'revoked';
  @Column({ type: 'varchar', length: 24, default: 'guest_email' })
  inviteKind!: 'guest_email' | 'workspace_share';
  @Column({ type: 'uuid', nullable: true }) targetOrganizationId!: string | null;
  @Column({ type: 'uuid', nullable: true }) acceptedByUserId!: string | null;
  @Column({ type: 'uuid', nullable: true }) partnerConversationId!: string | null;
  @Column({ type: 'uuid', nullable: true }) partnerOrganizationId!: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true })
  partnerOrganizationName!: string | null;
  @Column('uuid') createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
}

@Entity({ name: 'shared_channel_links' })
@Index(['partnerConversationId', 'status'])
@Index(['hostConversationId', 'status'])
export class SharedChannelLink {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') hostOrganizationId!: string;
  @Column('uuid') hostConversationId!: string;
  @Column('uuid') partnerOrganizationId!: string;
  @Column('uuid') partnerConversationId!: string;
  @Column({ type: 'varchar', length: 160, nullable: true })
  partnerOrganizationName!: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true })
  hostOrganizationName!: string | null;
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: 'pending' | 'active' | 'disconnected';
  @Column('uuid') createdBy!: string;
  @Column({ type: 'uuid', nullable: true }) acceptedBy!: string | null;
  @Column({ type: 'uuid', nullable: true }) inviteId!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) disconnectedAt!: Date | null;
}

@Entity({ name: 'installed_apps' })
@Index(['organizationId', 'appKey'], { unique: true })
export class InstalledApp {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column({ type: 'varchar', length: 80 }) appKey!: string;
  @Column({ type: 'jsonb', default: {} }) config!: Record<string, unknown>;
  @Column('uuid') installedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'app_oauth_connections' })
@Index(['organizationId', 'appKey'], { unique: true })
export class AppOauthConnection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column({ type: 'varchar', length: 80 }) appKey!: string;
  @Column({ type: 'varchar', length: 160, nullable: true })
  providerAccountId!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true })
  providerAccountName!: string | null;
  @Column({ type: 'text' }) accessTokenEnc!: string;
  @Column({ type: 'text', nullable: true }) refreshTokenEnc!: string | null;
  @Column({ type: 'varchar', length: 40, default: 'bearer' }) tokenType!: string;
  @Column({ type: 'text', nullable: true }) scopes!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt!: Date | null;
  @Column({ type: 'jsonb', default: {} }) meta!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 24, default: 'connected' })
  status!: 'connected' | 'needs_reauth' | 'error' | 'disconnected';
  @Column('uuid') installedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'app_external_refs' })
export class AppExternalRef {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column({ type: 'varchar', length: 80 }) appKey!: string;
  @Column({ type: 'uuid', nullable: true }) conversationId!: string | null;
  @Column({ type: 'uuid', nullable: true }) messageId!: string | null;
  @Column({ type: 'varchar', length: 200 }) externalId!: string;
  @Column({ type: 'varchar', length: 1000, nullable: true })
  externalUrl!: string | null;
  @Column({ type: 'varchar', length: 400, nullable: true }) title!: string | null;
  @Column('uuid') createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'user_notifications' })
@Index(['userId', 'createdAt'])
export class UserNotification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') userId!: string;
  @Column('uuid') actorId!: string;
  @Column({ type: 'varchar', length: 40 }) type!: string;
  @Column({ type: 'varchar', length: 200 }) title!: string;
  @Column({ type: 'varchar', length: 500, default: '' }) body!: string;
  @Column({ type: 'uuid', nullable: true }) conversationId!: string | null;
  @Column({ type: 'uuid', nullable: true }) listId!: string | null;
  @Column({ type: 'uuid', nullable: true }) listItemId!: string | null;
  @Column({ type: 'jsonb', default: {} }) meta!: Record<string, unknown>;
  @Column({ type: 'timestamptz', nullable: true }) readAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'canvas_comments' })
@Index(['conversationId', 'createdAt'])
export class CanvasComment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') conversationId!: string;
  @Column('uuid') authorId!: string;
  @Column({ type: 'varchar', length: 240, default: '' }) anchorText!: string;
  @Column({ type: 'int', default: 0 }) anchorOffset!: number;
  @Column({ type: 'varchar', length: 2000 }) body!: string;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'bookmark_collections' })
@Index(['userId', 'createdAt'])
export class BookmarkCollection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') organizationId!: string;
  @Column('uuid') userId!: string;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

export const SLACK_PRODUCT_ENTITIES = [
  ChannelCanvas,
  ChannelWhiteboard,
  ChannelList,
  ChannelListItem,
  ChannelListItemComment,
  ChannelClip,
  ChannelHuddle,
  ChannelWorkflow,
  SharedChannelInvite,
  SharedChannelLink,
  InstalledApp,
  AppOauthConnection,
  AppExternalRef,
  UserNotification,
  CanvasComment,
  BookmarkCollection,
];
