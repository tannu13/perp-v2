CREATE TABLE "processed_events" (
	"idempotency_key" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fills" ALTER COLUMN "qty" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fills" ALTER COLUMN "price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "qty" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "filled_qty" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "slippage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "initial_margin" SET NOT NULL;