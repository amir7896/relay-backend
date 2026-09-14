import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageBookmarks1743000001000 implements MigrationInterface {
  name = 'AddMessageBookmarks1743000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_bookmarks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_message_bookmarks_message_user" UNIQUE ("messageId", "userId"),
        CONSTRAINT "FK_message_bookmarks_message"
          FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_message_bookmarks_user_org"
       ON "message_bookmarks" ("organizationId", "userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_message_bookmarks_conversation_user"
       ON "message_bookmarks" ("conversationId", "userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_bookmarks_conversation_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_bookmarks_user_org"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "message_bookmarks"`);
  }
}
