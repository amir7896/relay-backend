import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrganizationMember } from './organization-member.entity';

@Entity({ name: 'organizations' })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: 'active' | 'suspended';

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** free | pro | enterprise — seat caps for billing MVP */
  @Column({ type: 'varchar', length: 32, default: 'free' })
  plan!: 'free' | 'pro' | 'enterprise';

  @Column({ type: 'int', default: 25 })
  maxSeats!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeSubscriptionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripePriceId!: string | null;

  @Column({ type: 'boolean', default: false })
  ssoEnabled!: boolean;

  @Column({ type: 'varchar', length: 32, nullable: true })
  ssoProvider!: 'oidc' | 'saml' | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ssoIssuerUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ssoClientId!: string | null;

  /** Confidential OIDC client secret — never expose in OrgSsoView. */
  @Column({ type: 'varchar', length: 500, nullable: true, select: false })
  ssoClientSecret!: string | null;

  @OneToMany(() => OrganizationMember, (member) => member.organization)
  members!: OrganizationMember[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
