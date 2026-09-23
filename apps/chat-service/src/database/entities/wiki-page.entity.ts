import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Workspace-scoped knowledge page (org wiki — not channel Canvas). */
@Entity({ name: 'wiki_pages' })
@Index(['organizationId', 'updatedAt'])
@Index(['organizationId', 'slug'], { unique: true })
export class WikiPage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  /** URL-safe unique key within the org (from title or custom). */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'uuid' })
  updatedBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
