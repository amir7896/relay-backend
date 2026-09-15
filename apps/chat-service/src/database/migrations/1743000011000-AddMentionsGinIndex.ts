import { MigrationInterface, QueryRunner } from 'typeorm';

/** Speeds unread-mention inbox queries that use jsonb @> on mentions. */
export class AddMentionsGinIndex1743000011000 implements MigrationInterface {
  name = 'AddMentionsGinIndex1743000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_mentions_gin"
      ON "messages" USING GIN ("mentions")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_mentions_gin"`);
  }
}
