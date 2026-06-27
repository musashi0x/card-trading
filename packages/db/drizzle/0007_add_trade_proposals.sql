CREATE TYPE "public"."trade_proposal_status" AS ENUM('proposed', 'accepted', 'declined', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposer" text NOT NULL,
	"counterparty" text NOT NULL,
	"give_card_ids" text[] NOT NULL,
	"get_card_ids" text[] NOT NULL,
	"cash_usdc" numeric(20, 7) DEFAULT '0' NOT NULL,
	"fee_usdc" numeric(20, 7) DEFAULT '0' NOT NULL,
	"status" "trade_proposal_status" DEFAULT 'proposed' NOT NULL,
	"contract_swap_id" integer,
	"propose_tx_hash" text,
	"swap_tx_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "listing_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "swap_tx_hash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_proposals_proposer_idx" ON "trade_proposals" USING btree ("proposer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_proposals_counterparty_idx" ON "trade_proposals" USING btree ("counterparty");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_proposals_status_expires_at_idx" ON "trade_proposals" USING btree ("status","expires_at");