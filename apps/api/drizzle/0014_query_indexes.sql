CREATE INDEX "agent_runs_audit_case_id_idx" ON "agent_runs" USING btree ("audit_case_id");--> statement-breakpoint
CREATE INDEX "agent_trace_steps_audit_case_id_idx" ON "agent_trace_steps" USING btree ("audit_case_id");--> statement-breakpoint
CREATE INDEX "audit_cases_status_created_at_idx" ON "audit_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_cases_stage_idx" ON "audit_cases" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "audit_cases_created_at_idx" ON "audit_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_snapshots_case_created_at_idx" ON "audit_snapshots" USING btree ("audit_case_id","created_at");--> statement-breakpoint
CREATE INDEX "finding_revisions_audit_case_id_idx" ON "finding_revisions" USING btree ("audit_case_id");--> statement-breakpoint
CREATE INDEX "finding_revisions_supersedes_id_idx" ON "finding_revisions" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "subject_verifications_audit_case_id_idx" ON "subject_verifications" USING btree ("audit_case_id");