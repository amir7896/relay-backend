import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListItemJiraFields1743000026000 implements MigrationInterface {
  name = 'AddListItemJiraFields1743000026000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "priority" varchar(16) NOT NULL DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS "labels" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "estimate" int,
        ADD COLUMN IF NOT EXISTS "parentItemId" uuid,
        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_list_item_comments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "listId" uuid NOT NULL,
        "itemId" uuid NOT NULL REFERENCES "channel_list_items"("id") ON DELETE CASCADE,
        "authorId" uuid NOT NULL,
        "body" varchar(4000) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_list_item_comments_item"
        ON "channel_list_item_comments" ("itemId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_list_item_comments"`);
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "labels",
        DROP COLUMN IF EXISTS "estimate",
        DROP COLUMN IF EXISTS "parentItemId",
        DROP COLUMN IF EXISTS "updatedAt"
    `);
  }
}
