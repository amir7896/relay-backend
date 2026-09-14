import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessagePins1730000008000 implements MigrationInterface {
  name = 'AddMessagePins1730000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "pinnedByUserId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_conversation_pinned"
       ON "messages" ("conversationId", "pinnedAt")
       WHERE "pinnedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_messages_conversation_pinned"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "pinnedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "pinnedAt"`,
    );
  }
}
