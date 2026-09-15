import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity({ name: 'thread_follows' })
@Unique('UQ_thread_follows_root_user', ['threadRootId', 'userId'])
export class ThreadFollow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  threadRootId!: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'threadRootId' })
  threadRoot!: Message;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /** Last time the user opened / read this thread */
  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
