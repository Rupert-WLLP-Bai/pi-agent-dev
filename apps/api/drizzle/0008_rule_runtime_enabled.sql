ALTER TABLE "rules" ADD COLUMN "enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "rules" ADD COLUMN "disabled_reason" text;
ALTER TABLE "rules" ADD COLUMN "disabled_by" text;
ALTER TABLE "rules" ADD COLUMN "disabled_at" timestamp with time zone;
