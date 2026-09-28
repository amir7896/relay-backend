import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type StuckSignalStatus = 'open' | 'helping' | 'resolved';

/**
 * Peer unblock signal — unique to Relay/DevStuck.
 * Not an incident war-room: a lightweight “I’m stuck, need a human” request.
 */
@Entity({ name: 'stuck_signals' })
@Index(['organizationId', 'status', 'updatedAt'])
@Index(['organizationId', 'conversationId', 'status'])
@Index(['organizationId', 'openedBy', 'status'])
export class StuckSignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'varchar', length: 500 })
  body!: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: StuckSignalStatus;

  @Column({ type: 'uuid' })
  openedBy!: string;

  @Column({ type: 'uuid', nullable: true })
  claimedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
