CREATE TYPE "public"."auction_status" AS ENUM('open', 'settled', 'cancelled', 'no_winner');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_auction_id" integer,
	"card_id" uuid NOT NULL,
	"seller" text NOT NULL,
	"start_price_usdc" numeric(20, 7) NOT NULL,
	"reserve_price_usdc" numeric(20, 7) DEFAULT '0' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"high_bidder" text,
	"high_bid_usdc" numeric(20, 7) DEFAULT '0' NOT NULL,
	"status" "auction_status" DEFAULT 'open' NOT NULL,
	"escrow_tx_hash" text,
	"settle_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"bidder" text NOT NULL,
	"amount_usdc" numeric(20, 7) NOT NULL,
	"contract_bid_ref" text,
	"escrow_tx_hash" text,
	"refund_tx_hash" text,
	"outbid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auctions_status_ends_at_idx" ON "auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_auction_amount_idx" ON "bids" USING btree ("auction_id","amount_usdc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_bidder_idx" ON "bids" USING btree ("bidder");