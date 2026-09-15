import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSsoSecretInviteRoleGuest1743000004000
  implements MigrationInterface
{
  name = 'AddSsoSecretInviteRoleGuest1743000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ssoClientSecret" varchar(500)
    `);
    await queryRunner.query(`
      ALTER TABLE "auth_tokens"
      ADD COLUMN IF NOT EXISTS "inviteRole" varchar(20) NOT NULL DEFAULT 'member'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth_tokens"
      DROP COLUMN IF EXISTS "inviteRole"
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      DROP COLUMN IF EXISTS "ssoClientSecret"
    `);
  }
}
