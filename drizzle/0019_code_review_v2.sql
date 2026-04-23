ALTER TABLE "pr_review_analyses" ADD COLUMN "technical_difficulty" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "execution_quality" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "test_adequacy" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "risk_handling" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "reviewability" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "analysis_confidence_pct" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "primary_surface" text DEFAULT 'mixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "approval_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "change_request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "review_comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "conversation_comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "review_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "time_to_first_review_minutes" integer;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "time_to_merge_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "commit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "commits_after_first_review" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "revert_within_14d" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "outcome_score" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "review_provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "review_model" text DEFAULT 'claude-opus-4-7' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "second_opinion_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "agreement_level" text DEFAULT 'single_model' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_review_analyses" ADD COLUMN "second_opinion_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;