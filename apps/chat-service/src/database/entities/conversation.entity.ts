import { ConversationType } from '@app/common';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConversationMember } from './conversation-member.entity';
import { Message } from './message.entity';

@Entity({ name: 'conversations' })
@Index('UQ_conversations_pairKey_active', ['organizationId', 'pairKey'], {
  unique: true,
  where: '"deletedAt" IS NULL AND "pairKey" IS NOT NULL',
})
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'enum', enum: ConversationType })
  type!: ConversationType;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Index()
  @Column({ type: 'varchar', length: 80, nullable: true })
  pairKey!: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  /** 0 = off. New messages expire after this many seconds. */
  @Column({ type: 'int', default: 0 })
  disappearingDurationSeconds!: number;

  /** public = any org member can browse/join; private = invite/add only */
  @Column({ type: 'varchar', length: 16, default: 'private' })
  visibility!: 'public' | 'private';

  /** When true, only owner/admin may post in the channel */
  @Column({ type: 'boolean', default: false })
  announceOnly!: boolean;

  /** Short Slack-style topic shown under the channel name */
  @Column({ type: 'varchar', length: 250, nullable: true })
  topic!: string | null;

  /** Longer channel purpose / description */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  /** Channel header bookmark links */
  @Column({ type: 'jsonb', default: [] })
  bookmarks!: Array<{
    id: string;
    title: string;
    url: string;
    createdBy: string;
    createdAt: string;
  }>;

  @Column({ type: 'boolean', default: false })
  isShared!: boolean;

  @Column({ type: 'varchar', length: 320, nullable: true })
  sharedExternalLabel!: string | null;

  @OneToMany(() => ConversationMember, (member) => member.conversation)
  members!: ConversationMember[];

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
