import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'retention_policies' })
export class RetentionPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  organizationId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 24, default: 'workspace' })
  scope!: 'workspace' | 'channel';

  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'int', default: 365 })
  retainDays!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column('uuid')
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'legal_holds' })
export class LegalHold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  organizationId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', default: '' })
  reason!: string;

  @Column({ type: 'varchar', length: 24, default: 'workspace' })
  scope!: 'workspace' | 'channel' | 'user';

  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column('uuid')
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  releasedBy!: string | null;
}

@Entity({ name: 'migration_jobs' })
export class MigrationJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  organizationId!: string;

  @Column({ type: 'varchar', length: 24 })
  source!: 'slack' | 'teams';

  @Column({ type: 'varchar', length: 24, default: 'completed' })
  status!: 'completed' | 'failed' | 'dry_run';

  @Column({ type: 'boolean', default: false })
  dryRun!: boolean;

  @Column({ type: 'jsonb', default: {} })
  summary!: Record<string, unknown>;

  @Column('uuid')
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
