import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSamlSsoFields1743000006000 implements MigrationInterface {
  name = 'AddSamlSsoFields1743000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ssoIdpSsoUrl" varchar(500)
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ssoIdpCertificate" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "ssoIdpCertificate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "ssoIdpSsoUrl"`,
    );
  }
}
