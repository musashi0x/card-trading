CREATE TYPE "public"."listing_status" AS ENUM('open', 'sold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('open', 'withdrawn', 'settled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_code" text NOT NULL,
	"issuer" text NOT NULL,
	"sac_address" text,
	"name" text NOT NULL,
	"set" text NOT NULL,
	"rarity" text NOT NULL,
	"image_url" text NOT NULL,
	"supply" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"seller" text NOT NULL,
	"price_usdc" numeric(20, 7) NOT NULL,
	"status" "listing_status" DEFAULT 'open' NOT NULL,
	"contract_listing_id" integer,
	"escrow_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer" text NOT NULL,
	"amount_usdc" numeric(20, 7) NOT NULL,
	"status" "offer_status" DEFAULT 'open' NOT NULL,
	"contract_offer_id" integer,
	"escrow_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer" text NOT NULL,
	"seller" text NOT NULL,
	"price_usdc" numeric(20, 7) NOT NULL,
	"fee_usdc" numeric(20, 7) NOT NULL,
	"settle_tx_hash" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stellar_address" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_stellar_address_unique" UNIQUE("stellar_address")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
