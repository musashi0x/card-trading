ALTER TABLE "cards" ADD COLUMN "creator_account" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "royalty_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "royalty_usdc" numeric(20, 7) DEFAULT '0' NOT NULL;