CREATE TABLE "contract_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_record_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_cases" ADD COLUMN "contract_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "finding_revisions" ADD COLUMN "rule_code" text;--> statement-breakpoint
ALTER TABLE "remediations" ADD COLUMN "closure_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "remediations" ADD COLUMN "closure_hint" text;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_revisions_contract_version_idx" ON "contract_revisions" USING btree ("contract_id","version");--> statement-breakpoint
CREATE INDEX "contract_revisions_contract_id_idx" ON "contract_revisions" USING btree ("contract_id");--> statement-breakpoint
ALTER TABLE "audit_cases" ADD CONSTRAINT "audit_cases_contract_revision_id_contract_revisions_id_fk" FOREIGN KEY ("contract_revision_id") REFERENCES "public"."contract_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_revisions_rule_code_idx" ON "finding_revisions" USING btree ("rule_code");