import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'message_drafts' })
@Index('UQ_message_drafts_org_user_conversation', [
  'organizationId',
  'userId',
  'conversationId',
], { unique: true })
export class MessageDraft {
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

  @Column({ type: 'varchar', length: 4000 })
  body!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
