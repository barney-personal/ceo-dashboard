CREATE TABLE "slack_employee_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_username" text,
	"slack_name" text,
	"employee_email" text,
	"employee_name" text,
	"match_method" text NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_employee_map_slack_user_id_unique" UNIQUE("slack_user_id")
);
