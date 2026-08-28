import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellReadyFeatures1730000006000 implements MigrationInterface {
  name = 'AddSellReadyFeatures1730000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'audio'`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "mentions" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "linkPreview" jsonb`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorId" uuid NOT NULL,
        "action" varchar(80) NOT NULL,
        "targetType" varchar(40),
        "targetId" varchar(120),
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_events_createdAt" ON "audit_events" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_events_actorId" ON "audit_events" ("actorId")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_settings" (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "appName" varchar(80) NOT NULL DEFAULT 'Relay',
        "tagline" varchar(200) NOT NULL DEFAULT 'Private team messenger',
        "primaryColor" varchar(16) NOT NULL DEFAULT '#2563eb',
        "logoUrl" varchar(500),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_workspace_settings_singleton" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(`
      INSERT INTO "workspace_settings" ("id", "appName", "tagline", "primaryColor")
      VALUES (1, 'Relay', 'Private team messenger', '#2563eb')
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_settings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_events_actorId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_events_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_events"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "linkPreview"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "mentions"`,
    );
  }
}
