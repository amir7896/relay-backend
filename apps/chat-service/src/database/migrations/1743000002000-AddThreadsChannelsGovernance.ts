import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThreadsChannelsGovernance1743000002000
  implements MigrationInterface
{
  name = 'AddThreadsChannelsGovernance1743000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
      ADD COLUMN IF NOT EXISTS "visibility" character varying(16) NOT NULL DEFAULT 'private'
    `);
    await queryRunner.query(`
      ALTER TABLE "conversations"
      ADD COLUMN IF NOT EXISTS "announceOnly" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversations_visibility"
      ON "conversations" ("organizationId", "visibility")
      WHERE "deletedAt" IS NULL AND "type" = 'group'
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "threadRootId" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_threadRootId"
      ON "messages" ("conversationId", "threadRootId")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "messages"
        ADD CONSTRAINT "FK_messages_threadRootId"
        FOREIGN KEY ("threadRootId") REFERENCES "messages"("id")
        ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "tokenHash" character varying(128) NOT NULL,
        "createdBy" uuid NOT NULL,
        "expiresAt" TIMESTAMPTZ,
        "revokedAt" TIMESTAMPTZ,
        "maxUses" int,
        "useCount" int NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_invites_tokenHash"
      ON "channel_invites" ("tokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_invites_conversation"
      ON "channel_invites" ("conversationId")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "channel_invites"
        ADD CONSTRAINT "FK_channel_invites_conversation"
        FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
        ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Existing #general-style groups stay joinable within the workspace.
    await queryRunner.query(`
      UPDATE "conversations"
      SET "visibility" = 'public'
      WHERE "type" = 'group'
        AND lower(coalesce("name", '')) = 'general'
        AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_invites"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_messages_threadRootId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_messages_threadRootId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "threadRootId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_conversations_visibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN IF EXISTS "announceOnly"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN IF EXISTS "visibility"`,
    );
  }
}
