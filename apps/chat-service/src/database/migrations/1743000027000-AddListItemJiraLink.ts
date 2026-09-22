import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListItemJiraLink1743000027000 implements MigrationInterface {
  name = 'AddListItemJiraLink1743000027000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        ADD COLUMN IF NOT EXISTS "jiraKey" varchar(40),
        ADD COLUMN IF NOT EXISTS "jiraUrl" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_list_items"
        DROP COLUMN IF EXISTS "jiraUrl",
        DROP COLUMN IF EXISTS "jiraKey"
    `);
  }
}
