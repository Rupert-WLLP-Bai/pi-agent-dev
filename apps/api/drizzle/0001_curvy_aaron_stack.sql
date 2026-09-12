CREATE TABLE "subject_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"party_id" text NOT NULL,
	"status" text NOT NULL,
	"source_record_id" uuid,
	"payload" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_snapshots" ADD COLUMN "parties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_snapshots" ALTER COLUMN "parties" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subject_verifications" ADD CONSTRAINT "subject_verifications_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE no action ON UPDATE no action;