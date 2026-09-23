import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncidents1743000032000 implements MigrationInterface {
  name = 'AddIncidents1743000032000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "incidents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "severity" varchar(8) NOT NULL,
        "title" varchar(200) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "openedBy" uuid NOT NULL,
        "resolvedBy" uuid,
        "resolvedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_incidents_org_status_updated"
        ON "incidents" ("organizationId", "status", "updatedAt");
      CREATE INDEX IF NOT EXISTS "IDX_incidents_org_conv_status"
        ON "incidents" ("organizationId", "conversationId", "status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "incidents";`);
  }
}
