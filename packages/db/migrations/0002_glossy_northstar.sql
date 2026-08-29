ALTER TABLE "markets" ADD COLUMN "base" varchar(16);--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "quote" varchar(16);--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "price_decimals" smallint;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "size_decimals" smallint;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "tick_size" varchar(32);--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "max_leverage" smallint;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "binance_symbol" varchar(32);