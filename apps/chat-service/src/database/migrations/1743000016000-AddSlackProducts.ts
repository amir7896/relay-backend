import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlackProducts1743000016000 implements MigrationInterface {
  name = 'AddSlackProducts1743000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
      ADD COLUMN IF NOT EXISTS "isShared" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "sharedExternalLabel" varchar(320)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_canvases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL, "title" varchar(160) NOT NULL DEFAULT '',
        "body" text NOT NULL DEFAULT '', "updatedBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_canvases_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_channel_canvases_org_conversation" UNIQUE ("organizationId", "conversationId")
      );
      CREATE TABLE IF NOT EXISTS "channel_lists" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL, "name" varchar(160) NOT NULL, "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_lists_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "channel_list_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "listId" uuid NOT NULL,
        "title" varchar(500) NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'todo',
        "assigneeId" uuid, "sortOrder" int NOT NULL DEFAULT 0, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_list_items_list" FOREIGN KEY ("listId") REFERENCES "channel_lists"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_channel_list_items_status" CHECK ("status" IN ('todo','doing','done'))
      );
      CREATE TABLE IF NOT EXISTS "channel_clips" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL, "messageId" uuid, "createdBy" uuid NOT NULL,
        "mediaUrl" varchar(1000) NOT NULL, "mediaType" varchar(16) NOT NULL,
        "durationSeconds" int, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_clips_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_channel_clips_media_type" CHECK ("mediaType" IN ('audio','video'))
      );
      CREATE TABLE IF NOT EXISTS "channel_huddles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'active',
        "startedBy" uuid NOT NULL, "participantIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "startedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "endedAt" TIMESTAMPTZ,
        CONSTRAINT "FK_channel_huddles_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_huddles_active" ON "channel_huddles" ("organizationId","conversationId") WHERE "status" = 'active';
      CREATE TABLE IF NOT EXISTS "channel_workflows" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid, "name" varchar(160) NOT NULL, "enabled" boolean NOT NULL DEFAULT true,
        "triggerType" varchar(32) NOT NULL, "triggerConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "actionType" varchar(32) NOT NULL, "actionConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdBy" uuid NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_workflows_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "shared_channel_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL, "email" varchar(320) NOT NULL, "token" varchar(128) NOT NULL UNIQUE,
        "status" varchar(16) NOT NULL DEFAULT 'pending', "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "acceptedAt" TIMESTAMPTZ,
        CONSTRAINT "FK_shared_invites_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "installed_apps" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL,
        "appKey" varchar(80) NOT NULL, "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "installedBy" uuid NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_installed_apps_org_key" UNIQUE ("organizationId","appKey")
      );
      CREATE INDEX IF NOT EXISTS "IDX_channel_lists_conversation" ON "channel_lists" ("organizationId","conversationId");
      CREATE INDEX IF NOT EXISTS "IDX_channel_clips_conversation" ON "channel_clips" ("organizationId","conversationId");
      CREATE INDEX IF NOT EXISTS "IDX_channel_workflows_org" ON "channel_workflows" ("organizationId","conversationId");
      CREATE INDEX IF NOT EXISTS "IDX_shared_invites_conversation" ON "shared_channel_invites" ("organizationId","conversationId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "installed_apps"; DROP TABLE IF EXISTS "shared_channel_invites";
      DROP TABLE IF EXISTS "channel_workflows"; DROP TABLE IF EXISTS "channel_huddles";
      DROP TABLE IF EXISTS "channel_clips"; DROP TABLE IF EXISTS "channel_list_items";
      DROP TABLE IF EXISTS "channel_lists"; DROP TABLE IF EXISTS "channel_canvases";
      ALTER TABLE "conversations" DROP COLUMN IF EXISTS "sharedExternalLabel", DROP COLUMN IF EXISTS "isShared";
    `);
  }
}
