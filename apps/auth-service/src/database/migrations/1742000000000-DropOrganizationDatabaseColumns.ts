import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slack-style shared tenancy: organizations no longer own dedicated Postgres DBs.
 */
export class DropOrganizationDatabaseColumns1742000000000
  implements MigrationInterface
{
  name = 'DropOrganizationDatabaseColumns1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_organizations_usersDatabase"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_organizations_chatDatabase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "usersDatabase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "chatDatabase"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "usersDatabase" varchar(63)`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "chatDatabase" varchar(63)`,
    );
    await queryRunner.query(
      `UPDATE "organizations" SET "usersDatabase" = 'legacy_users' WHERE "usersDatabase" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "organizations" SET "chatDatabase" = 'legacy_chat' WHERE "chatDatabase" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "usersDatabase" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ALTER COLUMN "chatDatabase" SET NOT NULL`,
    );
  }
}
