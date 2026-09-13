CREATE TABLE "remediations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"finding_revision_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"severity" text NOT NULL,
	"owner" text,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress_note" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "remediations" ADD CONSTRAINT "remediations_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediations" ADD CONSTRAINT "remediations_finding_revision_id_finding_revisions_id_fk" FOREIGN KEY ("finding_revision_id") REFERENCES "public"."finding_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "remediations_finding_revision_idx" ON "remediations" USING btree ("finding_revision_id");