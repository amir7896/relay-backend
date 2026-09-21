import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListCanvasBookmarkExtras1743000024000
  implements MigrationInterface
{
  name = 'AddListCanvasBookmarkExtras1743000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        ADD COLUMN IF NOT EXISTS "dueRemindedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "canvas_comments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "authorId" uuid NOT NULL,
        "anchorText" varchar(240) NOT NULL DEFAULT '',
        "anchorOffset" int NOT NULL DEFAULT 0,
        "body" varchar(2000) NOT NULL,
        "resolvedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_canvas_comments_conversation"
        ON "canvas_comments" ("conversationId", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bookmark_collections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bookmark_collections_user"
        ON "bookmark_collections" ("userId", "createdAt" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "message_bookmarks"
        ADD COLUMN IF NOT EXISTS "collectionId" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_bookmarks_collection"
        ON "message_bookmarks" ("collectionId")
        WHERE "collectionId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_bookmarks_collection"`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_bookmarks" DROP COLUMN IF EXISTS "collectionId"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookmark_collections"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_canvas_comments_conversation"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "canvas_comments"`);
    await queryRunner.query(`
      ALTER TABLE "channel_list_items" DROP COLUMN IF EXISTS "dueRemindedAt"
    `);
  }
}
