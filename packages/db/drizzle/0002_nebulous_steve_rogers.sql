CREATE TYPE "public"."fulfillment" AS ENUM('digital', 'physical');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('funded', 'shipped', 'disputed', 'released', 'refunded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer" text NOT NULL,
	"seller" text NOT NULL,
	"amount_usdc" numeric(20, 7) NOT NULL,
	"status" "order_status" DEFAULT 'funded' NOT NULL,
	"contract_order_id" integer,
	"confirm_deadline" bigint,
	"tracking_ref" text,
	"escrow_tx_hash" text,
	"settle_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "fulfillment" "fulfillment" DEFAULT 'digital' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
