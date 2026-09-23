import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelWhiteboards1743000028000 implements MigrationInterface {
  name = 'AddChannelWhiteboards1743000028000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_whiteboards" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "ydocState" text,
        "updatedBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_whiteboards_conversation"
          FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_channel_whiteboards_org_conversation"
          UNIQUE ("organizationId", "conversationId")
      );
      CREATE INDEX IF NOT EXISTS "IDX_channel_whiteboards_conversation"
        ON "channel_whiteboards" ("organizationId", "conversationId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_whiteboards";`);
  }
}
