import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlashCommands1743000013000 implements MigrationInterface {
  name = 'AddSlashCommands1743000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "slash_commands" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" varchar(32) NOT NULL,
        "description" varchar(160) NOT NULL,
        "responseTemplate" varchar(2000) NOT NULL,
        "createdBy" uuid NOT NULL,
        "revokedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_slash_commands_org_name_active"
      ON "slash_commands" ("organizationId", "name")
      WHERE "revokedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_slash_commands_org"
      ON "slash_commands" ("organizationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "slash_commands"`);
  }
}
