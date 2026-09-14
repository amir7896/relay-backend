import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'workspace_settings' })
export class WorkspaceSettings {
  @PrimaryColumn({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 80, default: 'Relay' })
  appName!: string;

  @Column({ type: 'varchar', length: 200, default: 'Private team messenger' })
  tagline!: string;

  @Column({ type: 'varchar', length: 16, default: '#2563eb' })
  primaryColor!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
