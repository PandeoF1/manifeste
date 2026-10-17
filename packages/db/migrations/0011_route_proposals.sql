CREATE TABLE "route_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"article_title" text,
	"published_at" timestamp with time zone,
	"city" text NOT NULL,
	"citycode" text,
	"day" text,
	"timing" text NOT NULL,
	"title" text NOT NULL,
	"places" jsonb NOT NULL,
	"line" jsonb,
	"line_km" double precision,
	"warnings" text[] DEFAULT '{}' NOT NULL,
	"group_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"event_id" uuid,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "route_proposals_status" CHECK ("route_proposals"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "route_proposals_timing" CHECK ("route_proposals"."timing" in ('announced', 'ongoing', 'past')),
	CONSTRAINT "route_proposals_url" CHECK ("route_proposals"."url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "route_scans" (
	"url" text PRIMARY KEY NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"found" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_proposals" ADD CONSTRAINT "route_proposals_event_id_movement_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."movement_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_proposals_status_created" ON "route_proposals" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "route_proposals_group" ON "route_proposals" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "route_proposals_url_city" ON "route_proposals" USING btree ("url","city");