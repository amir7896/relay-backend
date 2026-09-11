import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledMessages1730000009000 implements MigrationInterface {
  name = 'AddScheduledMessages1730000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scheduled_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversationId" uuid NOT NULL,
        "senderId" uuid NOT NULL,
        "body" varchar(4000) NOT NULL,
        "type" "messages_type_enum" NOT NULL DEFAULT 'text',
        "replyToMessageId" uuid,
        "attachmentUrl" varchar(500),
        "attachmentMime" varchar(120),
        "attachmentName" varchar(255),
        "attachmentSize" int,
        "mentions" jsonb NOT NULL DEFAULT '[]',
        "linkPreview" jsonb,
        "scheduledFor" TIMESTAMPTZ NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "sentMessageId" uuid,
        "error" text,
        "cancelledAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scheduled_messages_conversation"
       ON "scheduled_messages" ("conversationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scheduled_messages_sender"
       ON "scheduled_messages" ("senderId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scheduled_messages_due"
       ON "scheduled_messages" ("status", "scheduledFor")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scheduled_messages_due"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scheduled_messages_sender"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scheduled_messages_conversation"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_messages"`);
  }
}
