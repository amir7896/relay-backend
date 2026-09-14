import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Slack-style shared tenancy: profiles live in one DB, scoped by organizationId.
 */
export class SharedTenantUserOrganizationId1742000000001
  implements MigrationInterface
{
  name = 'SharedTenantUserOrganizationId1742000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "organizationId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "user_profiles" SET "organizationId" = '${LEGACY_ORGANIZATION_ID}' WHERE "organizationId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ALTER COLUMN "organizationId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_profiles_organizationId" ON "user_profiles" ("organizationId")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_user_profiles_userId_active"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_profiles_org_userId_active"
      ON "user_profiles" ("organizationId", "userId")
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_user_profiles_org_userId_active"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_profiles_userId_active"
      ON "user_profiles" ("userId")
      WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_profiles_organizationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" DROP COLUMN IF EXISTS "organizationId"`,
    );
  }
}
