CREATE TYPE "public"."analytics_page" AS ENUM('map', 'list', 'school', 'report', 'about', 'data', 'other');--> statement-breakpoint
CREATE TYPE "public"."certainty" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."date_basis" AS ENUM('extracted', 'announced', 'published');--> statement-breakpoint
CREATE TYPE "public"."judge_level" AS ENUM('secondary', 'higher', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."judge_nature" AS ENUM('blockade', 'closed', 'gathering', 'incident', 'other');--> statement-breakpoint
CREATE TYPE "public"."moderation_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."report_origin" AS ENUM('press', 'union', 'aggregator', 'on_site');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('blocked', 'filtering', 'lifted');--> statement-breakpoint
CREATE TYPE "public"."school_level" AS ENUM('secondary', 'higher');--> statement-breakpoint
CREATE TYPE "public"."source_health" AS ENUM('closed', 'open', 'half_open');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('telegram', 'rss', 'bluesky', 'mymaps');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('confirmed', 'mobilisation', 'not_retained', 'unjudged');--> statement-breakpoint
CREATE TYPE "public"."web_vital" AS ENUM('LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'API');--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_live" (
	"session" uuid PRIMARY KEY NOT NULL,
	"page" "analytics_page" NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_new_visitors" (
	"slot" timestamp with time zone PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "analytics_new_visitors_positive" CHECK ("analytics_new_visitors"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_online" (
	"minute" timestamp with time zone PRIMARY KEY NOT NULL,
	"online" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_page_views" (
	"slot" timestamp with time zone NOT NULL,
	"page" "analytics_page" NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_page_views_slot_page_pk" PRIMARY KEY("slot","page")
);
--> statement-breakpoint
CREATE TABLE "analytics_visitors_today" (
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_visitors_today_day_visitor_pk" PRIMARY KEY("day","visitor")
);
--> statement-breakpoint
CREATE TABLE "analytics_vitals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"page" "analytics_page" NOT NULL,
	"metric" "web_vital" NOT NULL,
	"value" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_limits" (
	"visitor" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "submission_limits_visitor_day_pk" PRIMARY KEY("visitor","day")
);
--> statement-breakpoint
CREATE TABLE "moderation_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "judgements" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"probability" real,
	"nature" "judge_nature",
	"level" "judge_level",
	"nature_probabilities" jsonb,
	"level_probabilities" jsonb,
	"chars" integer,
	"prompt_ref" text,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judgements_probability_range" CHECK ("judgements"."probability" is null or "judgements"."probability" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "report_submissions" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"distance_m" integer NOT NULL,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_submissions_lat" CHECK ("report_submissions"."lat" between -90 and 90),
	CONSTRAINT "report_submissions_lng" CHECK ("report_submissions"."lng" between -180 and 180),
	CONSTRAINT "report_submissions_distance" CHECK ("report_submissions"."distance_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_uai" text NOT NULL,
	"status" "report_status" NOT NULL,
	"origin" "report_origin" NOT NULL,
	"source_id" uuid,
	"source_url" text,
	"source_domain" text,
	"moderation" "moderation_state" DEFAULT 'pending' NOT NULL,
	"certainty" "certainty",
	"observed_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"extracted_observed_at" text,
	"date_basis" date_basis,
	"tier" "tier" DEFAULT 'unjudged' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"photo_key" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_source_required" CHECK ("reports"."origin" = 'on_site' or ("reports"."source_url" is not null and "reports"."source_domain" is not null)),
	CONSTRAINT "reports_source_url_https" CHECK ("reports"."source_url" ~ '^https://'),
	CONSTRAINT "reports_source_domain_format" CHECK ("reports"."source_domain" is null or ("reports"."source_domain" <> '' and "reports"."source_domain" = lower("reports"."source_domain")))
);
--> statement-breakpoint
CREATE TABLE "school_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"status" "report_status" NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"photo_key" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_proposals_name" CHECK (char_length("school_proposals"."name") between 3 and 120),
	CONSTRAINT "school_proposals_city" CHECK (char_length("school_proposals"."city") between 1 and 80),
	CONSTRAINT "school_proposals_lat" CHECK ("school_proposals"."lat" between -90 and 90),
	CONSTRAINT "school_proposals_lng" CHECK ("school_proposals"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"uai" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"postcode" text,
	"department" text,
	"academy" text,
	"kind" text,
	"level" "school_level" DEFAULT 'secondary' NOT NULL,
	"location" geography(Point,4326),
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"name_norm" text GENERATED ALWAYS AS (normalize_text(name)) STORED,
	"city_norm" text GENERATED ALWAYS AS (normalize_text(city)) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_uai_format" CHECK ("schools"."uai" ~ '^[0-9]{7}[A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"identifier" text NOT NULL,
	"label" text NOT NULL,
	"origin" "report_origin" DEFAULT 'aggregator' NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reports_hidden" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" "source_health" DEFAULT 'closed' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_kind_identifier_unique" UNIQUE("kind","identifier"),
	CONSTRAINT "sources_origin_collected" CHECK ("sources"."origin" <> 'on_site')
);
--> statement-breakpoint
CREATE TABLE "trusted_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"origin" "report_origin" NOT NULL,
	CONSTRAINT "trusted_domains_format" CHECK ("trusted_domains"."domain" = lower("trusted_domains"."domain") and "trusted_domains"."domain" !~ '^www\.'),
	CONSTRAINT "trusted_domains_origin" CHECK ("trusted_domains"."origin" in ('press', 'union'))
);
--> statement-breakpoint
ALTER TABLE "moderation_audit" ADD CONSTRAINT "moderation_audit_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_school_uai_schools_uai_fk" FOREIGN KEY ("school_uai") REFERENCES "public"."schools"("uai") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_moderated_by_auth_user_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_vitals_at_index" ON "analytics_vitals" USING btree ("at");--> statement-breakpoint
CREATE INDEX "moderation_audit_at_index" ON "moderation_audit" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_school_observed" ON "reports" USING btree ("school_uai","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_public_observed" ON "reports" USING btree ("observed_at" DESC NULLS LAST) WHERE "reports"."moderation" = 'approved' and not "reports"."hidden";--> statement-breakpoint
CREATE INDEX "reports_pending" ON "reports" USING btree ("created_at") WHERE "reports"."moderation" = 'pending';--> statement-breakpoint
CREATE INDEX "reports_source" ON "reports" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "schools_name_trgm" ON "schools" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "schools_city_trgm" ON "schools" USING gin ("city_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "schools_location" ON "schools" USING gist ("location");--> statement-breakpoint
CREATE INDEX "schools_department_index" ON "schools" USING btree ("department");--> statement-breakpoint
CREATE INDEX "schools_level_index" ON "schools" USING btree ("level");