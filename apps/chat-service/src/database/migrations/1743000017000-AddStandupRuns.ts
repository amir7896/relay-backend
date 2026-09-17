import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStandupRuns1743000017000 implements MigrationInterface {
  name = 'AddStandupRuns1743000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "standup_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "appKey" varchar(80) NOT NULL,
        "conversationId" uuid NOT NULL,
        "promptMessageId" uuid,
        "runDate" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "responses" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "promptedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "summarizedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_standup_runs_conversation" FOREIGN KEY ("conversationId")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_standup_runs_org_app_channel_date"
          UNIQUE ("organizationId","appKey","conversationId","runDate"),
        CONSTRAINT "CHK_standup_runs_status" CHECK ("status" IN ('open','closed'))
      );
      CREATE INDEX IF NOT EXISTS "IDX_standup_runs_open"
        ON "standup_runs" ("status","conversationId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "standup_runs";`);
  }
}
