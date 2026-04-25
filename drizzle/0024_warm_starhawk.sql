CREATE TABLE "engineer_match_judgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"judge_provider" text NOT NULL,
	"judge_model" text NOT NULL,
	"verdict" text NOT NULL,
	"confidence_pct" integer,
	"reasoning" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"thinking_tokens" integer,
	"cost_usd" numeric(10, 6),
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engineer_match_judgment_uniq" UNIQUE("match_id","judge_model")
);
--> statement-breakpoint
CREATE TABLE "engineer_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"engineer_a_email" text NOT NULL,
	"engineer_b_email" text NOT NULL,
	"rubric_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "engineer_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"engineer_email" text NOT NULL,
	"rating" numeric(8, 2) NOT NULL,
	"judgments_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engineer_rating_run_email_uniq" UNIQUE("run_id","engineer_email")
);
--> statement-breakpoint
CREATE TABLE "engineer_tournament_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"rubric_version" text NOT NULL,
	"match_target" integer NOT NULL,
	"matches_completed" integer DEFAULT 0 NOT NULL,
	"judgments_completed" integer DEFAULT 0 NOT NULL,
	"triggered_by" text NOT NULL,
	"notes" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "engineer_match_judgments" ADD CONSTRAINT "engineer_match_judgments_match_id_engineer_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."engineer_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineer_matches" ADD CONSTRAINT "engineer_matches_run_id_engineer_tournament_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."engineer_tournament_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineer_ratings" ADD CONSTRAINT "engineer_ratings_run_id_engineer_tournament_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."engineer_tournament_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engineer_match_judgments_match_idx" ON "engineer_match_judgments" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "engineer_matches_run_status_idx" ON "engineer_matches" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "engineer_matches_pair_idx" ON "engineer_matches" USING btree ("engineer_a_email","engineer_b_email");--> statement-breakpoint
CREATE INDEX "engineer_ratings_run_rating_idx" ON "engineer_ratings" USING btree ("run_id","rating");--> statement-breakpoint
CREATE INDEX "engineer_tournament_runs_status_idx" ON "engineer_tournament_runs" USING btree ("status","started_at");