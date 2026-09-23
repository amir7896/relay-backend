import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedReplies1743000030000 implements MigrationInterface {
  name = 'AddSavedReplies1743000030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_replies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "title" varchar(80) NOT NULL,
        "body" varchar(4000) NOT NULL,
        "shortcut" varchar(32),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_saved_replies_org_user_created"
        ON "saved_replies" ("organizationId", "userId", "createdAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_saved_replies_org_user_shortcut"
        ON "saved_replies" ("organizationId", "userId", "shortcut")
        WHERE "shortcut" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_replies";`);
  }
}
