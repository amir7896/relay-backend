import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncomingWebhooks1743000012000 implements MigrationInterface {
  name = 'AddIncomingWebhooks1743000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "incoming_webhooks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "tokenHash" varchar(128) NOT NULL,
        "defaultUsername" varchar(80) NOT NULL,
        "defaultIconUrl" varchar(500),
        "createdBy" uuid NOT NULL,
        "revokedAt" TIMESTAMPTZ,
        "lastUsedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_incoming_webhooks_conversation"
          FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_incoming_webhooks_tokenHash"
      ON "incoming_webhooks" ("tokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_incoming_webhooks_org"
      ON "incoming_webhooks" ("organizationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_incoming_webhooks_conversation"
      ON "incoming_webhooks" ("conversationId")
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "botUsername" varchar(80)
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "botIconUrl" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "botIconUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "botUsername"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "incoming_webhooks"`);
  }
}
