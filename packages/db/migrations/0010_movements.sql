CREATE TYPE "public"."event_kind" AS ENUM('march', 'rally', 'blockade');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('planned', 'ongoing', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."route_basis" AS ENUM('announced', 'probable');--> statement-breakpoint
CREATE TABLE "movement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid,
	"kind" "event_kind" NOT NULL,
	"title" text NOT NULL,
	"place" text,
	"status" "event_status" DEFAULT 'planned' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"route" jsonb,
	"route_basis" "route_basis",
	"source_url" text,
	"source_domain" text,
	"moderation" "moderation_state" DEFAULT 'pending' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_events_route_basis" CHECK ("movement_events"."route" is null or "movement_events"."route_basis" is not null),
	CONSTRAINT "movement_events_position" CHECK (("movement_events"."lat" is null) = ("movement_events"."lng" is null) and ("movement_events"."lat" is null or ("movement_events"."lat" between -90 and 90 and "movement_events"."lng" between -180 and 180))),
	CONSTRAINT "movement_events_source_https" CHECK ("movement_events"."source_url" is null or "movement_events"."source_url" ~ '^https://'),
	CONSTRAINT "movement_events_dates" CHECK ("movement_events"."ends_at" is null or "movement_events"."ends_at" >= "movement_events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_slug_unique" UNIQUE("slug"),
	CONSTRAINT "movements_slug_format" CHECK ("movements"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "movements_dates" CHECK ("movements"."ends_at" is null or "movements"."ends_at" >= "movements"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_events_movement_start" ON "movement_events" USING btree ("movement_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "movement_events_public_start" ON "movement_events" USING btree ("starts_at" DESC NULLS LAST) WHERE "movement_events"."moderation" = 'approved' and not "movement_events"."hidden";--> statement-breakpoint
CREATE INDEX "movements_status_start" ON "movements" USING btree ("status","starts_at" DESC NULLS LAST);