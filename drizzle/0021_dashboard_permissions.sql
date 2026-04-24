CREATE TABLE "dashboard_permission_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"permission_id" text NOT NULL,
	"required_role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_permission_overrides_permission_id_unique" UNIQUE("permission_id")
);
--> statement-breakpoint
CREATE INDEX "dashboard_permission_overrides_role_idx" ON "dashboard_permission_overrides" USING btree ("required_role");