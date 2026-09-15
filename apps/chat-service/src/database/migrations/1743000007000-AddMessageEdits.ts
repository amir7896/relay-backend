import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageEdits1743000007000 implements MigrationInterface {
  name = 'AddMessageEdits1743000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_edits" (
        "id" uuid PRIMARY KEY,
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "editorId" uuid NOT NULL,
        "body" varchar(4000) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_message_edits_message"
          FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_edits_message_created"
      ON "message_edits" ("messageId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_edits_org_conversation"
      ON "message_edits" ("organizationId", "conversationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "message_edits"`);
  }
}
