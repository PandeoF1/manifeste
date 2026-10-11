CREATE TYPE "public"."extraction_outcome" AS ENUM('reported', 'duplicate', 'low_certainty', 'stale', 'weekend', 'unmatched', 'no_source', 'failed');--> statement-breakpoint
CREATE TYPE "public"."item_state" AS ENUM('discovered', 'read', 'extracted', 'done', 'irrelevant', 'duplicate', 'no_event', 'unreadable', 'deferred', 'failed');--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"school_name" text NOT NULL,
	"city" text,
	"status" "report_status" NOT NULL,
	"certainty" "certainty" NOT NULL,
	"observed_at_raw" text,
	"nature" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"outcome" "extraction_outcome",
	"outcome_detail" text,
	"school_uai" text,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"publisher_domain" text,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"always_relevant" boolean DEFAULT false NOT NULL,
	"state" "item_state" DEFAULT 'discovered' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"merged_into" uuid,
	"run_id" uuid,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_contents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"chars" integer NOT NULL,
	"strategy" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"stage" text NOT NULL,
	"source_id" uuid,
	"item_id" uuid,
	"outcome" text NOT NULL,
	"duration_ms" integer,
	"detail" jsonb,
	"trace_id" text
);
--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"new_items" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "unmatched" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid,
	"source_id" uuid,
	"source_domain" text,
	"context" text,
	"school_name" text NOT NULL,
	"city" text,
	"status" "report_status" NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text,
	"linked_uai" text
);
--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_item_id_ingest_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ingest_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_school_uai_schools_uai_fk" FOREIGN KEY ("school_uai") REFERENCES "public"."schools"("uai") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_merged_into_ingest_items_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."ingest_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_contents" ADD CONSTRAINT "item_contents_item_id_ingest_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ingest_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched" ADD CONSTRAINT "unmatched_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched" ADD CONSTRAINT "unmatched_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched" ADD CONSTRAINT "unmatched_resolved_by_auth_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched" ADD CONSTRAINT "unmatched_linked_uai_schools_uai_fk" FOREIGN KEY ("linked_uai") REFERENCES "public"."schools"("uai") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extractions_item" ON "extractions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "extractions_unresolved" ON "extractions" USING btree ("created_at") WHERE "extractions"."outcome" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_items_source_external" ON "ingest_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "ingest_items_state" ON "ingest_items" USING btree ("state","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingest_items_discovered" ON "ingest_items" USING btree ("discovered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_events_at" ON "pipeline_events" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_events_stage_at" ON "pipeline_events" USING btree ("stage","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_events_item" ON "pipeline_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "source_runs_source" ON "source_runs" USING btree ("source_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unmatched_open" ON "unmatched" USING btree ("created_at" DESC NULLS LAST) WHERE "unmatched"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_collected_unique" ON "reports" USING btree ("school_uai","source_url","status") WHERE "reports"."origin" <> 'on_site' and "reports"."source_url" is not null;