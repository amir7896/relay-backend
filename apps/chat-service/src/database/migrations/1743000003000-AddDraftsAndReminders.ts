import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDraftsAndReminders1743000003000 implements MigrationInterface {
  name = 'AddDraftsAndReminders1743000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_drafts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "body" character varying(4000) NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_message_drafts_org_user_conversation"
          UNIQUE ("organizationId", "userId", "conversationId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_drafts_organizationId"
      ON "message_drafts" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_drafts_userId"
      ON "message_drafts" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_drafts_conversationId"
      ON "message_drafts" ("conversationId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_reminders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "remindAt" TIMESTAMPTZ NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "notifiedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_organizationId"
      ON "message_reminders" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_userId"
      ON "message_reminders" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_conversationId"
      ON "message_reminders" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_messageId"
      ON "message_reminders" ("messageId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_due"
      ON "message_reminders" ("status", "remindAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_due"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_messageId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_conversationId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_organizationId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "message_reminders"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_drafts_conversationId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_drafts_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_drafts_organizationId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "message_drafts"`);
  }
}
