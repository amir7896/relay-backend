import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSidebarSections1743000008000 implements MigrationInterface {
  name = 'AddSidebarSections1743000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sidebar_sections" (
        "id" uuid PRIMARY KEY,
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "sortOrder" int NOT NULL DEFAULT 0,
        "collapsed" boolean NOT NULL DEFAULT false,
        "conversationIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sidebar_sections_org_user_name"
          UNIQUE ("organizationId", "userId", "name")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sidebar_sections_org_user_order"
      ON "sidebar_sections" ("organizationId", "userId", "sortOrder")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sidebar_sections"`);
  }
}
