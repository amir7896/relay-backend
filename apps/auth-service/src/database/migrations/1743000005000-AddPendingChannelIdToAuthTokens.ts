import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingChannelIdToAuthTokens1743000005000
  implements MigrationInterface
{
  name = 'AddPendingChannelIdToAuthTokens1743000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth_tokens"
      ADD COLUMN IF NOT EXISTS "pendingChannelId" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_tokens_pendingChannelId"
      ON "auth_tokens" ("pendingChannelId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_tokens_pendingChannelId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "auth_tokens"
      DROP COLUMN IF EXISTS "pendingChannelId"
    `);
  }
}
