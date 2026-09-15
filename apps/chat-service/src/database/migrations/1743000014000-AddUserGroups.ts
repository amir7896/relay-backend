import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserGroups1743000014000 implements MigrationInterface {
  name = 'AddUserGroups1743000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" varchar(32) NOT NULL,
        "displayName" varchar(80) NOT NULL,
        "description" varchar(240),
        "memberIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_groups_org_name"
      ON "user_groups" ("organizationId", "name")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_groups_org"
      ON "user_groups" ("organizationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
  }
}
