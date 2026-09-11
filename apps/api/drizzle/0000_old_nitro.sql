CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"version" text NOT NULL,
	"usage" jsonb,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"policy" jsonb,
	"evidence" jsonb NOT NULL,
	"rule_assessment" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"supersedes_id" uuid,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_text" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_cases" ADD CONSTRAINT "audit_cases_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_snapshots" ADD CONSTRAINT "audit_snapshots_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_snapshots" ADD CONSTRAINT "audit_snapshots_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_revisions" ADD CONSTRAINT "finding_revisions_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE no action ON UPDATE no action;