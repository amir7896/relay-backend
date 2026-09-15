import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Postgres full-text search over message body + attachment file names.
 * Generated column stays in sync on insert/update without app triggers.
 */
export class AddMessageSearchVector1743000010000 implements MigrationInterface {
  name = 'AddMessageSearchVector1743000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN IF NOT EXISTS "searchVector" tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("body", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("attachmentName", '')), 'B')
      ) STORED
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_search_vector"
      ON "messages" USING GIN ("searchVector")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_search_vector"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "searchVector"`,
    );
  }
}
