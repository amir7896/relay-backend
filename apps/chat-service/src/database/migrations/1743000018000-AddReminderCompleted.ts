import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReminderCompleted1743000018000 implements MigrationInterface {
  name = 'AddReminderCompleted1743000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "message_reminders"
        ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_message_reminders_user_status"
        ON "message_reminders" ("organizationId", "userId", "status", "remindAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_reminders_user_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_reminders" DROP COLUMN IF EXISTS "completedAt"
    `);
  }
}
