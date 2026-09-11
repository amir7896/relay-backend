import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisappearingMessages1730000010000
  implements MigrationInterface
{
  name = 'AddDisappearingMessages1730000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "disappearingDurationSeconds" int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_expires_at"
       ON "messages" ("expiresAt")
       WHERE "expiresAt" IS NOT NULL AND "deletedForEveryoneAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_expires_at"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN IF EXISTS "disappearingDurationSeconds"`,
    );
  }
}
