import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThreadFollows1743000005000 implements MigrationInterface {
  name = 'AddThreadFollows1743000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "thread_follows" (
        "id" uuid PRIMARY KEY,
        "organizationId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "threadRootId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "lastReadAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_thread_follows_root_user" UNIQUE ("threadRootId", "userId"),
        CONSTRAINT "FK_thread_follows_root"
          FOREIGN KEY ("threadRootId") REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_thread_follows_org_user"
       ON "thread_follows" ("organizationId", "userId", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_thread_follows_conversation_user"
       ON "thread_follows" ("conversationId", "userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_thread_follows_root"
       ON "thread_follows" ("threadRootId")`,
    );

    // Backfill: anyone who started or replied in a thread follows it.
    await queryRunner.query(`
      INSERT INTO "thread_follows" (
        "id", "organizationId", "conversationId", "threadRootId", "userId", "lastReadAt"
      )
      SELECT
        md5(random()::text || clock_timestamp()::text || sender_id::text || root_id::text)::uuid,
        organization_id,
        conversation_id,
        root_id,
        sender_id,
        last_read_at
      FROM (
        SELECT DISTINCT
          m."organizationId" AS organization_id,
          m."conversationId" AS conversation_id,
          COALESCE(m."threadRootId", m."id") AS root_id,
          m."senderId" AS sender_id,
          MAX(m."createdAt") AS last_read_at
        FROM "messages" m
        WHERE m."deletedForEveryoneAt" IS NULL
          AND (
            m."threadRootId" IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM "messages" r
              WHERE r."threadRootId" = m."id"
                AND r."organizationId" = m."organizationId"
            )
          )
        GROUP BY
          m."organizationId",
          m."conversationId",
          COALESCE(m."threadRootId", m."id"),
          m."senderId"
      ) seeded
      ON CONFLICT ("threadRootId", "userId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_thread_follows_root"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_thread_follows_conversation_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_thread_follows_org_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "thread_follows"`);
  }
}
