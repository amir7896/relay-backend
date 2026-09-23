import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageInteractive1743000029000 implements MigrationInterface {
  name = 'AddMessageInteractive1743000029000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'interactive'`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "interactive" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN IF EXISTS "interactive"`,
    );
  }
}
