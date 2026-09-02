import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuthTokenType {
  EMAIL_VERIFY = 'email_verify',
  PASSWORD_RESET = 'password_reset',
  INVITE = 'invite',
}

@Entity({ name: 'auth_tokens' })
@Index('IDX_auth_tokens_hash', ['tokenHash'], { unique: true })
@Index('IDX_auth_tokens_type_email', ['type', 'email'])
export class AuthToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: AuthTokenType })
  type!: AuthTokenType;

  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'int', default: 1 })
  maxUses!: number;

  @Column({ type: 'int', default: 0 })
  usedCount!: number;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
