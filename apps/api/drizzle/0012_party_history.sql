CREATE TABLE "party_history_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_history_records" ADD CONSTRAINT "party_history_records_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE cascade ON UPDATE no action;
