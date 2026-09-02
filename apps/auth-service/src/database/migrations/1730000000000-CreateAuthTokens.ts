import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthTokens1730000000000 implements MigrationInterface {
  name = 'CreateAuthTokens1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "auth_tokens_type_enum" AS ENUM (
          'email_verify',
          'password_reset',
          'invite'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" "auth_tokens_type_enum" NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "email" character varying(255),
        "userId" uuid,
        "createdByUserId" uuid,
        "maxUses" integer NOT NULL DEFAULT 1,
        "usedCount" integer NOT NULL DEFAULT 0,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_auth_tokens_hash" ON "auth_tokens" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_tokens_type_email" ON "auth_tokens" ("type", "email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_tokens_type_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_tokens_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_tokens"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auth_tokens_type_enum"`);
  }
}
