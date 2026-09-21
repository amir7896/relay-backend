import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListItemDueAt1743000023000 implements MigrationInterface {
  name = 'AddListItemDueAt1743000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_channel_list_items_dueAt"
        ON "channel_list_items" ("dueAt")
        WHERE "dueAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_channel_list_items_dueAt"`);
    await queryRunner.query(`
      ALTER TABLE "channel_list_items" DROP COLUMN IF EXISTS "dueAt"
    `);
  }
}
