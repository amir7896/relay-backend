import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppOauthConnections1743000020000 implements MigrationInterface {
  name = 'AddAppOauthConnections1743000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_oauth_connections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "appKey" varchar(80) NOT NULL,
        "providerAccountId" varchar(160),
        "providerAccountName" varchar(200),
        "accessTokenEnc" text NOT NULL,
        "refreshTokenEnc" text,
        "tokenType" varchar(40) DEFAULT 'bearer',
        "scopes" text,
        "expiresAt" TIMESTAMPTZ,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(24) NOT NULL DEFAULT 'connected',
        "installedBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_app_oauth_connections_org_app"
          UNIQUE ("organizationId", "appKey"),
        CONSTRAINT "CHK_app_oauth_connections_status"
          CHECK ("status" IN ('connected','needs_reauth','error','disconnected'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_app_oauth_connections_org"
        ON "app_oauth_connections" ("organizationId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_external_refs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "appKey" varchar(80) NOT NULL,
        "conversationId" uuid,
        "messageId" uuid,
        "externalId" varchar(200) NOT NULL,
        "externalUrl" varchar(1000),
        "title" varchar(400),
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_app_external_refs_message"
        ON "app_external_refs" ("messageId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_external_refs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "app_oauth_connections"`);
  }
}
