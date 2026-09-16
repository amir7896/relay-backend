import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutgoingWebhooksAndSlashInteractive1743000015000
  implements MigrationInterface
{
  name = 'AddOutgoingWebhooksAndSlashInteractive1743000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outgoing_webhooks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "targetUrl" varchar(500) NOT NULL,
        "signingSecret" varchar(128) NOT NULL,
        "excludeBots" boolean NOT NULL DEFAULT true,
        "createdBy" uuid NOT NULL,
        "revokedAt" TIMESTAMPTZ,
        "lastDeliveredAt" TIMESTAMPTZ,
        "failureCount" int NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_outgoing_webhooks_conversation"
          FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outgoing_webhooks_organizationId"
      ON "outgoing_webhooks" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outgoing_webhooks_conversationId"
      ON "outgoing_webhooks" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outgoing_webhooks_active_conversation"
      ON "outgoing_webhooks" ("conversationId")
      WHERE "revokedAt" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "slash_commands"
      ADD COLUMN IF NOT EXISTS "responseMode" varchar(20) NOT NULL DEFAULT 'in_channel'
    `);
    await queryRunner.query(`
      ALTER TABLE "slash_commands"
      ADD COLUMN IF NOT EXISTS "requestUrl" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "slash_commands" DROP COLUMN IF EXISTS "requestUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "slash_commands" DROP COLUMN IF EXISTS "responseMode"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "outgoing_webhooks"`);
  }
}
