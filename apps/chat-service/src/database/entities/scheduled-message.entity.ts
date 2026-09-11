import { MessageType } from '@app/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ScheduledMessageStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

@Entity({ name: 'scheduled_messages' })
@Index('IDX_scheduled_messages_due', ['status', 'scheduledFor'])
export class ScheduledMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

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

  @Column({ type: 'uuid', nullable: true })
  replyToMessageId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  attachmentUrl!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  attachmentMime!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentName!: string | null;

  @Column({ type: 'int', nullable: true })
  attachmentSize!: number | null;

  @Column({ type: 'jsonb', default: [] })
  mentions!: string[];

  @Column({ type: 'jsonb', nullable: true })
  linkPreview!: {
    url: string;
    title: string;
    description: string;
    image: string | null;
  } | null;

  @Index()
  @Column({ type: 'timestamptz' })
  scheduledFor!: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: ScheduledMessageStatus;

  @Column({ type: 'uuid', nullable: true })
  sentMessageId!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
