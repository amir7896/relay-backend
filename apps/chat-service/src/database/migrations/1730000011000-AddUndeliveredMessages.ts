import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUndeliveredMessages1730000011000
  implements MigrationInterface
{
  name = 'AddUndeliveredMessages1730000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "undelivered" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_undelivered"
       ON "messages" ("conversationId", "createdAt")
       WHERE "undelivered" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_undelivered"`);
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "undelivered"`,
    );
  }
}
