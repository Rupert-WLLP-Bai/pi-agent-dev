-- Forward migration: change audit_action_logs.created_at from timestamp
-- without time zone to timestamptz. Databases that applied the original
-- 0009 (before the type fix) still have the wrong column type; this
-- migration repairs them. Fresh databases already get timestamptz from
-- the corrected 0009.
ALTER TABLE "audit_action_logs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
