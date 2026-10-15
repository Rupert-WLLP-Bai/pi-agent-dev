CREATE TABLE "ocr_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton_key" text DEFAULT 'singleton' NOT NULL,
	"provider" text DEFAULT 'off' NOT NULL,
	"vlm_endpoint" text DEFAULT '' NOT NULL,
	"vlm_api_key" text DEFAULT '' NOT NULL,
	"vlm_model" text DEFAULT '' NOT NULL,
	"vlm_fallback_model" text,
	"mineru_endpoint" text DEFAULT '' NOT NULL,
	"max_pages" integer DEFAULT 40 NOT NULL,
	"scale" double precision DEFAULT 2 NOT NULL,
	"jpeg_quality" integer DEFAULT 85 NOT NULL,
	"concurrency" integer DEFAULT 3 NOT NULL,
	"request_timeout_ms" integer DEFAULT 120000 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_ok" boolean,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_settings_singleton_idx" ON "ocr_settings" USING btree ("singleton_key");