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
   * In-channel / ephemeral reply template. Supports `{text}` and `{user}`.
   * Optional when `requestUrl` is set (remote handler provides text).
   */
  @Column({ type: 'varchar', length: 2000, default: '' })
  responseTemplate!: string;

  /** `in_channel` posts a visible message; `ephemeral` returns only to the invoker. */
  @Column({ type: 'varchar', length: 20, default: 'in_channel' })
  responseMode!: 'in_channel' | 'ephemeral';

  /**
   * Optional HTTPS URL. When set, Relay POSTs the slash payload and uses the
   * JSON response (`text` + optional `response_type`).
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  requestUrl!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
