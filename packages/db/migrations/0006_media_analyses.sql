CREATE TABLE "media_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"source_id" uuid,
	"published_at" timestamp with time zone,
	"about_movement" boolean NOT NULL,
	"mentions_demands" boolean NOT NULL,
	"demands" text[] DEFAULT '{}' NOT NULL,
	"voices" text[] DEFAULT '{}' NOT NULL,
	"focus" text NOT NULL,
	"incidents" boolean NOT NULL,
	"police_violence" boolean NOT NULL,
	"terms" text[] DEFAULT '{}' NOT NULL,
	"tone" text NOT NULL,
	"quote_demands" text,
	"quote_framing" text,
	"model" text,
	"prompt_version" text,
	"text_chars" integer,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_analyses_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "media_analyses" ADD CONSTRAINT "media_analyses_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_analyses_domain" ON "media_analyses" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "media_analyses_published" ON "media_analyses" USING btree ("published_at" DESC NULLS LAST);