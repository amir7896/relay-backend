import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'user_blocks' })
@Unique('UQ_user_blocks_pair', ['organizationId', 'blockerId', 'blockedId'])
export class UserBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  blockerId!: string;

  @Index()
  @Column({ type: 'uuid' })
  blockedId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
