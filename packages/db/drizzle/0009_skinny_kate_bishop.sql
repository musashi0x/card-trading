CREATE TABLE IF NOT EXISTS "card_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"token_id" integer NOT NULL,
	"serial" integer NOT NULL,
	"owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Legacy rows predate the NFT-copy model and have no card_copy to point at,
-- so the NOT NULL columns below cannot be added while they exist. Purge them
-- (and their dependents) — the fungible-asset marketplace data is unusable
-- under the new model anyway.
DELETE FROM "bids";--> statement-breakpoint
DELETE FROM "auctions";--> statement-breakpoint
DELETE FROM "watchlist";--> statement-breakpoint
DELETE FROM "reviews" WHERE "trade_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "trades";--> statement-breakpoint
DELETE FROM "orders";--> statement-breakpoint
DELETE FROM "offers";--> statement-breakpoint
DELETE FROM "listings";--> statement-breakpoint
DELETE FROM "trade_proposals";--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "card_copy_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "card_copy_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD COLUMN "give_card_copy_ids" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD COLUMN "get_card_copy_ids" text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_copies_token_id_unique" ON "card_copies" USING btree ("token_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_copies_card_serial_unique" ON "card_copies" USING btree ("card_id","serial");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_copies_owner_idx" ON "card_copies" USING btree ("owner");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_card_copy_id_card_copies_id_fk" FOREIGN KEY ("card_copy_id") REFERENCES "public"."card_copies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_card_copy_id_card_copies_id_fk" FOREIGN KEY ("card_copy_id") REFERENCES "public"."card_copies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN IF EXISTS "asset_code";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN IF EXISTS "issuer";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN IF EXISTS "sac_address";--> statement-breakpoint
ALTER TABLE "trade_proposals" DROP COLUMN IF EXISTS "give_card_ids";--> statement-breakpoint
ALTER TABLE "trade_proposals" DROP COLUMN IF EXISTS "get_card_ids";