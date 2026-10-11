CREATE TABLE "ai_usage" (
	"hour" timestamp with time zone NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"thoughts_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms_total" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_hour_task_provider_model_prompt_version_pk" PRIMARY KEY("hour","task","provider","model","prompt_version")
);
--> statement-breakpoint
CREATE INDEX "ai_usage_hour_index" ON "ai_usage" USING btree ("hour" DESC NULLS LAST);