import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'saved_replies' })
@Index(['organizationId', 'userId', 'createdAt'])
@Index(['organizationId', 'userId', 'shortcut'], {
  unique: true,
  where: '"shortcut" IS NOT NULL',
})
export class SavedReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @Column({ type: 'varchar', length: 4000 })
  body!: string;

  /** Optional short code for /sr <shortcut> (lowercase alphanumeric). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  shortcut!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
