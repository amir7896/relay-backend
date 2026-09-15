import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelTopicDescriptionBookmarks1743000004000
  implements MigrationInterface
{
  name = 'AddChannelTopicDescriptionBookmarks1743000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN IF NOT EXISTS "topic" varchar(250),
        ADD COLUMN IF NOT EXISTS "description" varchar(2000),
        ADD COLUMN IF NOT EXISTS "bookmarks" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversations"
        DROP COLUMN IF EXISTS "bookmarks",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "topic"
    `);
  }
}
