ALTER TYPE "public"."event_kind" ADD VALUE 'signaled';--> statement-breakpoint
CREATE TABLE "signal_scans" (
	"url" text PRIMARY KEY NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"found" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "scope" text DEFAULT 'school' NOT NULL;--> statement-breakpoint
ALTER TABLE "movement_events" ADD COLUMN "zone" jsonb;--> statement-breakpoint
ALTER TABLE "movement_events" ADD COLUMN "precision" text;--> statement-breakpoint
ALTER TABLE "movement_events" ADD COLUMN "citycode" text;--> statement-breakpoint
ALTER TABLE "movement_events" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "movement_events_dedupe" ON "movement_events" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_scope" CHECK ("ingest_items"."scope" in ('school', 'demonstration'));--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_precision" CHECK ("movement_events"."precision" is null or "movement_events"."precision" in ('point', 'district', 'city'));