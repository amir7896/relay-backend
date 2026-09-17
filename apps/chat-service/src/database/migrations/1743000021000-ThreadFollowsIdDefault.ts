import { MigrationInterface, QueryRunner } from 'typeorm';

export class ThreadFollowsIdDefault1743000021000 implements MigrationInterface {
  name = 'ThreadFollowsIdDefault1743000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "thread_follows"
        ALTER COLUMN "id" SET DEFAULT gen_random_uuid()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "thread_follows"
        ALTER COLUMN "id" DROP DEFAULT
    `);
  }
}
