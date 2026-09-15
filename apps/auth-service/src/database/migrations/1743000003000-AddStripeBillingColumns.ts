import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStripeBillingColumns1743000003000
  implements MigrationInterface
{
  name = 'AddStripeBillingColumns1743000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "stripePriceId" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripePriceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripeSubscriptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "stripeCustomerId"`,
    );
  }
}
