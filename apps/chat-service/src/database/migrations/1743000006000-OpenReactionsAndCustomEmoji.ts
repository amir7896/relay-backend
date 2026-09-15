import { MigrationInterface, QueryRunner } from 'typeorm';

export class OpenReactionsAndCustomEmoji1743000006000
  implements MigrationInterface
{
  name = 'OpenReactionsAndCustomEmoji1743000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message_reactions"
      ALTER COLUMN "emoji" TYPE varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_settings"
      ADD COLUMN IF NOT EXISTS "customEmojis" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings"
      DROP COLUMN IF EXISTS "customEmojis"
    `);
    await queryRunner.query(`
      ALTER TABLE "message_reactions"
      ALTER COLUMN "emoji" TYPE varchar(16)
    `);
  }
}
