import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCanvasYdocState1743000025000 implements MigrationInterface {
  name = 'AddCanvasYdocState1743000025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_canvases"
        ADD COLUMN IF NOT EXISTS "ydocState" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_canvases"
        DROP COLUMN IF EXISTS "ydocState"
    `);
  }
}
