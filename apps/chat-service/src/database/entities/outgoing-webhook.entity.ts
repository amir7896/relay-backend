import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity({ name: 'outgoing_webhooks' })
export class OutgoingWebhook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** HTTPS endpoint that receives signed event POSTs. */
  @Column({ type: 'varchar', length: 500 })
  targetUrl!: string;

  /**
   * Shared secret used to HMAC-sign delivery bodies.
   * Shown once on create; needed server-side to sign.
   */
  @Column({ type: 'varchar', length: 128 })
  signingSecret!: string;

  /** Skip messages that have a botUsername (incoming webhooks / bots). */
  @Column({ type: 'boolean', default: true })
  excludeBots!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveredAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  failureCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
