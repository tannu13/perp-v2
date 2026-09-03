/**
 * Prune the synthetic liquidity `apps/market-maker` leaves behind.
 *
 * The bot quotes a twenty-level ladder a side across three markets and rewrites
 * a rung whenever the index crosses a grid cell. Every one of those is an
 * `orders` INSERT that is never deleted, so a demo box left running fills up
 * with cancelled orders — measured at a few hundred rows a minute, and the row
 * that made this necessary was a 30 MB database that was 99.98% bot churn.
 *
 * What it keeps, and why the query is not just "delete where user_id = bot":
 *
 * - **Fills with a human on one side survive**, and so do the bot orders behind
 *   them. Those are somebody's trade history — the bot is the counterparty, not
 *   the subject — and `fills` has foreign keys onto `orders`, so deleting the
 *   bot's side would take the record of a real trade with it. Only bot-versus-
 *   bot fills are noise, and only bot orders left unreferenced afterwards are
 *   safe to drop.
 * - **The bot's `users` rows survive.** `bot-account.ts` signs in first and
 *   only signs up on failure, so deleting them just means the next boot mints
 *   new accounts and new collateral. Keeping them is free and keeps the ids
 *   stable across prunes.
 *
 * Run it with the stack DOWN. `apps/engine` holds the live book in memory and
 * Postgres is a downstream record of it, so pruning underneath a running engine
 * leaves the two disagreeing about what is resting — orders the engine will
 * happily match against rows that no longer exist. The check is not a
 * formality; `--force` exists only for a box where the ports are taken by
 * something else.
 *
 *   cd packages/db && bun run db:prune              # prune
 *   cd packages/db && bun run db:prune --dry-run    # count first, change nothing
 */
import { sql } from "drizzle-orm";
import db from "./index";

const DEFAULT_BOTS = ["market-maker-bot", "flow-bot"];

/** Ports that mean the stack is up. The engine has none — these stand in for it. */
const STACK_PORTS = [
  { port: 3000, name: "apps/backend" },
  { port: 3010, name: "apps/ws-server" },
];

const flag = (name: string) => process.argv.includes(`--${name}`);

const option = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

/**
 * Bot usernames from the market maker's own config, not a constant in here.
 *
 * `MM_USERNAME` and `TAKER_USERNAME` are configurable, and a prune that cleaned
 * up the wrong two accounts would be both useless and destructive. Parsed
 * rather than imported because `apps/market-maker/src/env.ts` exits the process
 * on a missing password, which is the right behaviour there and the wrong one
 * for a maintenance script that does not need one.
 */
const botUsernames = async (): Promise<string[]> => {
  const override = option("bots");
  if (override) return override.split(",").map((name) => name.trim()).filter(Boolean);

  const path = new URL("../../../apps/market-maker/.env", import.meta.url);
  const file = Bun.file(path);
  if (!(await file.exists())) return DEFAULT_BOTS;

  const text = await file.text();
  const read = (key: string) =>
    text
      .split("\n")
      .find((line) => line.trimStart().startsWith(`${key}=`))
      ?.split("=")
      .slice(1)
      .join("=")
      .trim();

  return [
    read("MM_USERNAME") ?? DEFAULT_BOTS[0]!,
    read("TAKER_USERNAME") ?? DEFAULT_BOTS[1]!,
  ];
};

const stackIsUp = async () => {
  const running: string[] = [];
  for (const { port, name } of STACK_PORTS) {
    try {
      using socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: { data() {}, error() {} },
      });
      socket.end();
      running.push(`${name} (:${port})`);
    } catch {
      // Nothing listening, which is what we want.
    }
  }
  return running;
};

const count = async (query: ReturnType<typeof sql>) => {
  const [row] = await db.execute<{ n: string }>(query);
  return Number(row?.n ?? 0);
};

const databaseSize = async () => {
  const [row] = await db.execute<{ size: string }>(
    sql`select pg_size_pretty(pg_database_size(current_database())) as size`,
  );
  return row?.size ?? "unknown";
};

export const pruneBotData = async ({
  bots,
  dryRun = false,
  keepEvents = false,
}: {
  bots: string[];
  dryRun?: boolean;
  keepEvents?: boolean;
}) => {
  const ids = await db.execute<{ id: string; username: string }>(
    sql`select id, username from users where username in ${sql`(${sql.join(
      bots.map((name) => sql`${name}`),
      sql`, `,
    )})`}`,
  );

  if (!ids.length) {
    return { bots: [], orders: 0, fills: 0, events: 0, kept: 0 };
  }

  const botIds = sql`(${sql.join(
    ids.map((row) => sql`${row.id}::uuid`),
    sql`, `,
  )})`;

  /** Bot-versus-bot only. A fill with a human on either side is real history. */
  const noiseFills = sql`
    select id from fills
    where maker_id in ${botIds} and taker_id in ${botIds}
  `;

  /**
   * Orders that no fill will still point at once the noise fills are gone.
   * NOT IN over a nullable column would be a trap; neither column is nullable,
   * so the plain form is correct here.
   */
  const orphanOrders = sql`
    select o.id from orders o
    where o.user_id in ${botIds}
      and not exists (
        select 1 from fills f
        where (f.maker_order_id = o.id or f.taker_order_id = o.id)
          and f.id not in (${noiseFills})
      )
  `;

  const fillCount = await count(sql`select count(*)::text as n from (${noiseFills}) t`);
  const orderCount = await count(sql`select count(*)::text as n from (${orphanOrders}) t`);
  const eventCount = keepEvents
    ? 0
    : await count(sql`select count(*)::text as n from processed_events`);
  const kept = await count(
    sql`select count(*)::text as n from orders where user_id in ${botIds}`,
  );

  if (!dryRun) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from fills where id in (${noiseFills})`);
      await tx.execute(sql`delete from orders where id in (${orphanOrders})`);
      if (!keepEvents) await tx.execute(sql`delete from processed_events`);
    });
  }

  return {
    bots: ids.map((row) => `${row.username} (${row.id})`),
    orders: orderCount,
    fills: fillCount,
    events: eventCount,
    kept: kept - orderCount,
  };
};

if (import.meta.main) {
  const dryRun = flag("dry-run");
  const keepEvents = flag("keep-events");

  const running = await stackIsUp();
  if (running.length && !flag("force")) {
    console.error(
      `Refusing to prune: ${running.join(", ")} still listening.\n` +
        `apps/engine holds the live book in memory and Postgres is a record of it, ` +
        `so pruning now leaves the two disagreeing about what is resting.\n` +
        `Stop the stack and re-run, or pass --force if these ports are something else.`,
    );
    process.exit(1);
  }

  const bots = await botUsernames();
  const before = await databaseSize();
  const result = await pruneBotData({ bots, dryRun, keepEvents });

  if (!result.bots.length) {
    console.log(`No bot accounts found for: ${bots.join(", ")} — nothing to prune.`);
    process.exit(0);
  }

  const verb = dryRun ? "would delete" : "deleted";
  console.log(`bots:      ${result.bots.join("\n           ")}`);
  console.log(`${verb}:   ${result.orders.toLocaleString()} orders`);
  console.log(`${verb}:   ${result.fills.toLocaleString()} bot-vs-bot fills`);
  if (!keepEvents) {
    console.log(`${verb}:   ${result.events.toLocaleString()} processed_events`);
  }
  console.log(
    `kept:      ${result.kept.toLocaleString()} bot orders behind fills with a real user`,
  );

  if (dryRun) {
    console.log(`\ndatabase:  ${before} (dry run — nothing changed)`);
    process.exit(0);
  }

  /**
   * FULL, because plain VACUUM only marks the pages reusable and the point of
   * running this is to get the disk back. It takes an exclusive lock, which is
   * free here precisely because the script already insisted the stack is down.
   */
  console.log("\nvacuuming…");
  await db.execute(sql`vacuum (full, analyze) orders`);
  await db.execute(sql`vacuum (full, analyze) fills`);
  if (!keepEvents) await db.execute(sql`vacuum (full, analyze) processed_events`);

  console.log(`database:  ${before} → ${await databaseSize()}`);
  process.exit(0);
}
