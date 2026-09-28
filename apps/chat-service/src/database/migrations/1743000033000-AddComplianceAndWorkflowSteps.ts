import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComplianceAndWorkflowSteps1743000033000
  implements MigrationInterface
{
  name = 'AddComplianceAndWorkflowSteps1743000033000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_workflows"
        ADD COLUMN IF NOT EXISTS "steps" jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "retention_policies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "scope" varchar(24) NOT NULL DEFAULT 'workspace',
        "conversationId" uuid,
        "retainDays" integer NOT NULL DEFAULT 365,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_retention_policies_org"
        ON "retention_policies" ("organizationId", "enabled");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_holds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "reason" text NOT NULL DEFAULT '',
        "scope" varchar(24) NOT NULL DEFAULT 'workspace',
        "conversationId" uuid,
        "userId" uuid,
        "active" boolean NOT NULL DEFAULT true,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "releasedAt" TIMESTAMPTZ,
        "releasedBy" uuid
      );
      CREATE INDEX IF NOT EXISTS "IDX_legal_holds_org_active"
        ON "legal_holds" ("organizationId", "active");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "migration_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "source" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'completed',
        "dryRun" boolean NOT NULL DEFAULT false,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdBy" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_migration_jobs_org_created"
        ON "migration_jobs" ("organizationId", "createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "migration_jobs";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_holds";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "retention_policies";`);
    await queryRunner.query(`
      ALTER TABLE "channel_workflows" DROP COLUMN IF EXISTS "steps";
    `);
  }
}
