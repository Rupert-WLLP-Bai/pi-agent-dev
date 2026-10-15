CREATE TABLE "demo_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"database_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadow_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadow_jobs" (
	"decision_id" uuid PRIMARY KEY NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"agent_run_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"question_key" text NOT NULL,
	"question_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"redaction_version" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"frozen_input" jsonb NOT NULL,
	"result" jsonb,
	"fallback_reason" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shadow_feedback" ADD CONSTRAINT "shadow_feedback_decision_id_shadow_jobs_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."shadow_jobs"("decision_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_jobs" ADD CONSTRAINT "shadow_jobs_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_jobs" ADD CONSTRAINT "shadow_jobs_snapshot_id_audit_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."audit_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shadow_feedback_decision_id_idx" ON "shadow_feedback" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shadow_feedback_idempotency_idx" ON "shadow_feedback" USING btree ("decision_id","actor","idempotency_key") WHERE "shadow_feedback"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shadow_jobs_identity_idx" ON "shadow_jobs" USING btree ("agent_run_id","question_key","question_version","policy_version","redaction_version","input_hash","provider","model_version");--> statement-breakpoint
CREATE INDEX "shadow_jobs_audit_case_id_idx" ON "shadow_jobs" USING btree ("audit_case_id");--> statement-breakpoint
CREATE INDEX "shadow_jobs_status_lease_idx" ON "shadow_jobs" USING btree ("status","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "shadow_jobs_terminal_created_at_idx" ON "shadow_jobs" USING btree ("status","completed_at") WHERE "shadow_jobs"."status" IN ('SUCCEEDED', 'FAILED', 'SKIPPED');