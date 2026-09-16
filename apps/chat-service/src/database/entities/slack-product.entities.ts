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
  @Column({ type: 'varchar', length: 16, default: 'todo' }) status!: 'todo' | 'doing' | 'done';
  @Column({ type: 'uuid', nullable: true }) assigneeId!: string | null;
  @Column({ type: 'int', default: 0 }) sortOrder!: number;
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
  @Column('uuid') createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
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

export const SLACK_PRODUCT_ENTITIES = [
  ChannelCanvas,
  ChannelList,
  ChannelListItem,
  ChannelClip,
  ChannelHuddle,
  ChannelWorkflow,
  SharedChannelInvite,
  InstalledApp,
];
