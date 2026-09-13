CREATE TABLE "validation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_code" text NOT NULL,
	"case_type" text NOT NULL,
	"name" text NOT NULL,
	"input" text NOT NULL,
	"expected_disposition" text NOT NULL,
	"expected_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "validation_cases_rule_name_idx" ON "validation_cases" USING btree ("rule_code","name");