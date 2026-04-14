CREATE TABLE "github_employee_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"employee_name" text,
	"employee_email" text,
	"github_name" text,
	"match_method" text NOT NULL,
	"match_confidence" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_employee_map_github_login_unique" UNIQUE("github_login")
);
