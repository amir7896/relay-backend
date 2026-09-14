import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenAvatarUrl1740000000001 implements MigrationInterface {
  name = 'WidenAvatarUrl1740000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ALTER COLUMN "avatar" TYPE varchar(1024)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ALTER COLUMN "avatar" TYPE varchar(500)`,
    );
  }
}
