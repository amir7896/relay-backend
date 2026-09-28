import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStuckSignals1743000034000 implements MigrationInterface {
  name = 'AddStuckSignals1743000034000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stuck_signals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "body" varchar(500) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "openedBy" uuid NOT NULL,
        "claimedBy" uuid,
        "resolvedBy" uuid,
        "resolvedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_stuck_signals_org_status_updated"
        ON "stuck_signals" ("organizationId", "status", "updatedAt");
      CREATE INDEX IF NOT EXISTS "IDX_stuck_signals_org_conv_status"
        ON "stuck_signals" ("organizationId", "conversationId", "status");
      CREATE INDEX IF NOT EXISTS "IDX_stuck_signals_org_opened_status"
        ON "stuck_signals" ("organizationId", "openedBy", "status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "stuck_signals";`);
  }
}
