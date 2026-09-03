import type { ApiClient } from "./api-client";

/**
 * Keeps a bot account signed in and solvent.
 *
 * The top-up is what makes "leave it running for days" true. Its named cost:
 * every `POST /onramp` mints collateral into `store.totalSystemDeposits`, so
 * the exchange's notion of total deposits drifts upward for as long as the bot
 * runs. That is correct for paper trading and was chosen deliberately — it is
 * not a bug to be rediscovered later.
 */

export type Balances = { available: number; locked: number };

export type Position = {
  marketId: string;
  type: "LONG" | "SHORT";
  qty: number;
  margin: number;
  averagePrice: number;
  liquidationPrice: number;
  pnL: number;
};

export const createBotAccount = ({
  client,
  balanceFloor,
  topUp,
}: {
  client: ApiClient;
  balanceFloor: number;
  topUp: number;
}) => {
  let lastTopUpAt = 0;

  const balances = async () => {
    const body = await client.get<{ balances: Balances }>("/equity/balances");
    return body.balances;
  };

  /**
   * Tops up when free collateral falls under the floor.
   *
   * Rate-limited to once every ten seconds because the maker calls it from its
   * error path: a burst of "User does not have available margin" — which is
   * what a whole ladder looks like when the account runs dry — would otherwise
   * fire one onramp per rejected order and deposit ten times what was needed.
   */
  const ensureFunds = async (force = false) => {
    const current = await balances();
    if (!force && current.available >= balanceFloor) return current;
    if (Date.now() - lastTopUpAt < 10_000) return current;

    lastTopUpAt = Date.now();
    await client.post("/onramp", { amount: topUp });
    const topped = await balances();
    console.log(
      `[${client.label}] topped up +${topUp} → available ${topped.available.toFixed(2)}`,
    );
    return topped;
  };

  const openPositions = async (marketId: string) => {
    const body = await client.get<{ positions: Position[] }>(
      `/positions/open/${marketId}`,
    );
    return body.positions ?? [];
  };

  /**
   * Inventory for one market as a single signed number.
   *
   * Positive is long. Marked at the current anchor rather than the entry price
   * because the skew is a risk control: what matters is the exposure the bot is
   * carrying now, not what it paid for it.
   */
  const signedInventoryNotional = async (marketId: string, markPrice: number) => {
    const positions = await openPositions(marketId);
    return positions.reduce((total, position) => {
      const notional = position.qty * markPrice;
      return total + (position.type === "LONG" ? notional : -notional);
    }, 0);
  };

  return {
    client,
    async boot() {
      await client.ensureSession();
      const current = await ensureFunds();
      console.log(
        `[${client.label}] signed in as ${client.userId} — available ${current.available.toFixed(2)}, locked ${current.locked.toFixed(2)}`,
      );
    },
    balances,
    ensureFunds,
    openPositions,
    signedInventoryNotional,
  };
};

export type BotAccount = ReturnType<typeof createBotAccount>;
