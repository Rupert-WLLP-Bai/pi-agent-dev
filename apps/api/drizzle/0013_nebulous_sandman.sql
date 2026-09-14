CREATE TABLE "llm_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"model" text NOT NULL,
	"api_key" text NOT NULL,
	"max_input" integer DEFAULT 128000 NOT NULL,
	"max_output" integer DEFAULT 4096 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_ok" boolean,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_providers_active_idx" ON "llm_providers" USING btree ("is_active") WHERE "llm_providers"."is_active";