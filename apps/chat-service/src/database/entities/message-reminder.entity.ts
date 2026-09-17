import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type MessageReminderStatus =
  | 'pending'
  | 'sent'
  | 'cancelled'
  | 'completed';

@Entity({ name: 'message_reminders' })
@Index('IDX_message_reminders_due', ['status', 'remindAt'])
export class MessageReminder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  messageId!: string;

  @Column({ type: 'timestamptz' })
  remindAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: MessageReminderStatus;

  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
