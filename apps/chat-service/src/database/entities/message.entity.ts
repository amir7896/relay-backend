import { MessageType } from '@app/common';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity({ name: 'messages' })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @Index()
  @Column({ type: 'uuid' })
  senderId!: string;

  @Column({ type: 'varchar', length: 4000 })
  body!: string;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  type!: MessageType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  replyToMessageId!: string | null;

  /** Slack-style thread root; null = main timeline message */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  threadRootId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedForEveryoneAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  pinnedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  pinnedByUserId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  attachmentUrl!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  attachmentMime!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentName!: string | null;

  @Column({ type: 'int', nullable: true })
  attachmentSize!: number | null;

  /** When set, message is shown as an integration/bot post. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  botUsername!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  botIconUrl!: string | null;

  @Column({ type: 'uuid', nullable: true })
  forwardedFromMessageId!: string | null;

  @Column({ type: 'jsonb', default: [] })
  mentions!: string[];

  @Column({ type: 'jsonb', nullable: true })
  linkPreview!: {
    url: string;
    title: string;
    description: string;
    image: string | null;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  poll!: {
    question: string;
    options: Array<{ id: string; text: string; voterIds: string[] }>;
    allowMultiple: boolean;
    closed: boolean;
  } | null;

  /** Block Kit–lite interactive card (approvals, action buttons). */
  @Column({ type: 'jsonb', nullable: true })
  interactive!: {
    kind: 'approval';
    title: string;
    status: 'open' | 'approved' | 'denied';
    actions: Array<{
      id: string;
      label: string;
      style: 'primary' | 'danger' | 'default';
      value: 'approve' | 'deny';
    }>;
    decidedBy: string | null;
    decidedAt: string | null;
    decidedValue: 'approve' | 'deny' | null;
  } | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  /** True when sender blocked the peer — visible only to sender, never delivered. */
  @Column({ type: 'boolean', default: false })
  undelivered!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
