import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCallMessageType1730000007000 implements MigrationInterface {
  name = 'AddCallMessageType1730000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "messages_type_enum" ADD VALUE IF NOT EXISTS 'call'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot easily remove enum values
  }
}
