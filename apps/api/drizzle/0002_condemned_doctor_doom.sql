CREATE TABLE "agent_trace_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"audit_case_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"label" text NOT NULL,
	"ref" text,
	"input" jsonb,
	"output" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"tokens" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_trace_steps" ADD CONSTRAINT "agent_trace_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace_steps" ADD CONSTRAINT "agent_trace_steps_audit_case_id_audit_cases_id_fk" FOREIGN KEY ("audit_case_id") REFERENCES "public"."audit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trace_steps_run_sequence_idx" ON "agent_trace_steps" USING btree ("run_id","sequence");