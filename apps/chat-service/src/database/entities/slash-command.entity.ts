import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'slash_commands' })
export class SlashCommand {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  /** Command name without leading slash (e.g. "deploy"). */
  @Column({ type: 'varchar', length: 32 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  description!: string;

  /**
   * In-channel reply template. Supports `{text}` and `{user}`.
   * Example: "Ship it: {text}"
   */
  @Column({ type: 'varchar', length: 2000 })
  responseTemplate!: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
