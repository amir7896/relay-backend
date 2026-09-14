import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInviteOrganizationId1743000000000
  implements MigrationInterface
{
  name = 'AddInviteOrganizationId1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD COLUMN IF NOT EXISTS "organizationId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_tokens_organizationId" ON "auth_tokens" ("organizationId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_tokens_organizationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" DROP COLUMN IF EXISTS "organizationId"`,
    );
  }
}
