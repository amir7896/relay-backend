import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSharedChannelLinks1743000019000 implements MigrationInterface {
  name = 'AddSharedChannelLinks1743000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shared_channel_invites"
        ADD COLUMN IF NOT EXISTS "inviteKind" varchar(24) NOT NULL DEFAULT 'guest_email',
        ADD COLUMN IF NOT EXISTS "targetOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "acceptedByUserId" uuid,
        ADD COLUMN IF NOT EXISTS "partnerConversationId" uuid,
        ADD COLUMN IF NOT EXISTS "partnerOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "partnerOrganizationName" varchar(160)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shared_channel_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "hostOrganizationId" uuid NOT NULL,
        "hostConversationId" uuid NOT NULL,
        "partnerOrganizationId" uuid NOT NULL,
        "partnerConversationId" uuid NOT NULL,
        "partnerOrganizationName" varchar(160),
        "hostOrganizationName" varchar(160),
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "createdBy" uuid NOT NULL,
        "acceptedBy" uuid,
        "inviteId" uuid,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "disconnectedAt" TIMESTAMPTZ,
        CONSTRAINT "FK_shared_channel_links_host_conversation"
          FOREIGN KEY ("hostConversationId") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_shared_channel_links_host_partner"
          UNIQUE ("hostConversationId", "partnerOrganizationId"),
        CONSTRAINT "CHK_shared_channel_links_status"
          CHECK ("status" IN ('pending','active','disconnected'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shared_channel_links_partner_conversation"
        ON "shared_channel_links" ("partnerConversationId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shared_channel_links_host_conversation"
        ON "shared_channel_links" ("hostConversationId", "status")
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        ADD COLUMN IF NOT EXISTS "homeOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "membershipSource" varchar(24) NOT NULL DEFAULT 'native'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        DROP COLUMN IF EXISTS "membershipSource",
        DROP COLUMN IF EXISTS "homeOrganizationId"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "shared_channel_links"`);
    await queryRunner.query(`
      ALTER TABLE "shared_channel_invites"
        DROP COLUMN IF EXISTS "partnerOrganizationName",
        DROP COLUMN IF EXISTS "partnerOrganizationId",
        DROP COLUMN IF EXISTS "partnerConversationId",
        DROP COLUMN IF EXISTS "acceptedByUserId",
        DROP COLUMN IF EXISTS "targetOrganizationId",
        DROP COLUMN IF EXISTS "inviteKind"
    `);
  }
}
