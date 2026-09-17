import { ConversationMemberRole } from '@app/common';
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

@Entity({ name: 'conversation_members' })
@Index('UQ_conversation_members_active', ['conversationId', 'userId'], {
  unique: true,
  where: '"leftAt" IS NULL',
})
export class ConversationMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: ConversationMemberRole,
    default: ConversationMemberRole.MEMBER,
  })
  role!: ConversationMemberRole;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  mutedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pinnedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  homeOrganizationId!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'native' })
  membershipSource!: 'native' | 'connect_guest' | 'connect_partner';
}
