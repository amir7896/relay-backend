import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessagePolls1743000000000 implements MigrationInterface {
  name = 'AddMessagePolls1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'poll'`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "poll" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "poll"`,
    );
  }
}
