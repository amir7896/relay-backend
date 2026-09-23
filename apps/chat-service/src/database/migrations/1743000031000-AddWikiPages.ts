import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWikiPages1743000031000 implements MigrationInterface {
  name = 'AddWikiPages1743000031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wiki_pages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "slug" varchar(80) NOT NULL,
        "body" text NOT NULL,
        "createdBy" uuid NOT NULL,
        "updatedBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_wiki_pages_org_updated"
        ON "wiki_pages" ("organizationId", "updatedAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wiki_pages_org_slug"
        ON "wiki_pages" ("organizationId", "slug");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wiki_pages";`);
  }
}
