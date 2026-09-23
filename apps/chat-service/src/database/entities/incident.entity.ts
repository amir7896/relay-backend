import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type IncidentStatus = 'open' | 'mitigated' | 'resolved';

/** Channel war-room incident (ops mode). */
@Entity({ name: 'incidents' })
@Index(['organizationId', 'status', 'updatedAt'])
@Index(['organizationId', 'conversationId', 'status'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'varchar', length: 8 })
  severity!: IncidentSeverity;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: IncidentStatus;

  @Column({ type: 'uuid' })
  openedBy!: string;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
