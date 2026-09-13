CREATE TABLE IF NOT EXISTS "audit_action_logs" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "rule_id" uuid NOT NULL,
  "action" varchar(32) NOT NULL,
  "actor" varchar(64) NOT NULL,
  "reason" text,
  "version_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
