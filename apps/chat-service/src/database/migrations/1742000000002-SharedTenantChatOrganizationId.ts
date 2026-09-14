import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';

export class SharedTenantChatOrganizationId1742000000002 implements MigrationInterface {
  name = 'SharedTenantChatOrganizationId1742000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'conversations',
      'messages',
      'user_blocks',
      'audit_events',
      'scheduled_messages',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "organizationId" uuid`,
      );
      await queryRunner.query(
        `UPDATE "${table}" SET "organizationId" = '${LEGACY_ORGANIZATION_ID}' WHERE "organizationId" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "organizationId" SET NOT NULL`,
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_${table}_organizationId" ON "${table}" ("organizationId")`,
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_conversations_pairKey_active"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversations_pairKey_active"
      ON "conversations" ("organizationId", "pairKey")
      WHERE "deletedAt" IS NULL AND "pairKey" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "user_blocks" DROP CONSTRAINT IF EXISTS "UQ_user_blocks_pair"`,
    );
    await queryRunner.query(`
      ALTER TABLE "user_blocks"
      ADD CONSTRAINT "UQ_user_blocks_pair"
      UNIQUE ("organizationId", "blockerId", "blockedId")
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_settings"`);
    await queryRunner.query(`
      CREATE TABLE "workspace_settings" (
        "organizationId" uuid PRIMARY KEY,
        "appName" varchar(80) NOT NULL DEFAULT 'Relay',
        "tagline" varchar(200) NOT NULL DEFAULT 'Private team messenger',
        "primaryColor" varchar(16) NOT NULL DEFAULT '#2563eb',
        "logoUrl" varchar(500),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_settings"`);
    await queryRunner.query(`
      CREATE TABLE "workspace_settings" (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "appName" varchar(80) NOT NULL DEFAULT 'Relay',
        "tagline" varchar(200) NOT NULL DEFAULT 'Private team messenger',
        "primaryColor" varchar(16) NOT NULL DEFAULT '#2563eb',
        "logoUrl" varchar(500),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_workspace_settings_singleton" CHECK ("id" = 1)
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "user_blocks" DROP CONSTRAINT IF EXISTS "UQ_user_blocks_pair"`,
    );
    await queryRunner.query(`
      ALTER TABLE "user_blocks"
      ADD CONSTRAINT "UQ_user_blocks_pair" UNIQUE ("blockerId", "blockedId")
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_conversations_pairKey_active"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversations_pairKey_active"
      ON "conversations" ("pairKey")
      WHERE "deletedAt" IS NULL AND "pairKey" IS NOT NULL
    `);

    for (const table of [
      'scheduled_messages',
      'audit_events',
      'user_blocks',
      'messages',
      'conversations',
    ]) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_${table}_organizationId"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "organizationId"`,
      );
    }
  }
}
