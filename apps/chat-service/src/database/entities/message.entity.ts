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

  @Column({ type: 'timestamptz', nullable: true })
  deletedForEveryoneAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  attachmentUrl!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  attachmentMime!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentName!: string | null;

  @Column({ type: 'int', nullable: true })
  attachmentSize!: number | null;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
