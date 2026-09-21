import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserNotifications1743000022000 implements MigrationInterface {
  name = 'AddUserNotifications1743000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "actorId" uuid NOT NULL,
        "type" varchar(40) NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" varchar(500) NOT NULL DEFAULT '',
        "conversationId" uuid,
        "listId" uuid,
        "listItemId" uuid,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "readAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_notifications_user_created"
        ON "user_notifications" ("userId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_notifications_user_unread"
        ON "user_notifications" ("userId")
        WHERE "readAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_notifications_user_unread"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_notifications_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_notifications"`);
  }
}
