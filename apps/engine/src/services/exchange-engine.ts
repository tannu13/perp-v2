import type {
  InsertFillRecord,
  InsertOrderRecord,
  SelectOrderRecord,
  TOrderStatusesEnum,
} from "@repo/db/schema";
import type {
  FillRecordNumberified,
  OrderRecordNumberified,
  TBid,
  TFill,
  TOpenOrder,
  TOrderbook,
  TOrderType,
  TPosition,
  TPositionType,
  TStore,
  TSupportedAssets,
  TUser,
  TUsers,
} from "../store";
import {
  type TEngineRequestSchema,
  type TOrderDataForWriterSchema,
  type TTradePrintSchema,
  type TUserEventSchema,
  type TUserOrderSchema,
  type TWriterSchema,
  type TWsServerSchema,
  type TWsUserSchema,
} from "@repo/shared/redis-events";
import type { TUploadToS3 } from "./upload-file";

export function createEngine({
  store,
  uploadToS3,
}: {
  store: TStore;
  uploadToS3: TUploadToS3;
}) {
  // for price priority
  const getNextBestAskPrice = (asks: TOrderbook["asks"], startFrom = -1) => {
    let minPrice = Infinity;

    for (const [price, ask] of Object.entries(asks)) {
      const currentPrice = Number(price);
      if (
        minPrice > currentPrice &&
        currentPrice > Number(startFrom) &&
        ask.availableQty > 0
      ) {
        minPrice = currentPrice;
      }
    }

    return minPrice === Infinity ? null : minPrice;
  };

  // for price priority
  const getNextBestBidPrice = (
    bids: TOrderbook["bids"],
    startFrom = Infinity,
  ) => {
    let maxPrice = -Infinity;

    for (const [price, bid] of Object.entries(bids)) {
      const currentPrice = Number(price);
      if (
        currentPrice > maxPrice &&
        Number(startFrom) > currentPrice &&
        bid.availableQty > 0
      ) {
        maxPrice = currentPrice;
      }
    }

    return maxPrice === -Infinity ? null : maxPrice;
  };

  // for time priority
  const getFirstCreatedOrder = (openOrders: TOpenOrder[]) => {
    if (openOrders.length < 1) return null;
    let firstOrder: TOpenOrder = openOrders[0]!;
    let minIndex = 0;
    for (let i = 1; i < openOrders.length; i++) {
      const currentOrder = openOrders[i]!;
      if (firstOrder.createdAt > currentOrder.createdAt) {
        firstOrder = openOrders[i]!;
        minIndex = i;
      }
    }

    return {
      orderIndex: minIndex,
      order: firstOrder,
    };
  };

  const stringifyFill = (fill: FillRecordNumberified): InsertFillRecord => {
    return {
      ...fill,
      qty: `${fill.qty}`,
      price: `${fill.price}`,
    };
  };

  /**
   * Fills → public prints.
   *
   * The only thing a fill does not already know is which of its two accounts
   * was the aggressor, so the taker's side is passed in by the caller — which
   * is always in a position to know it: `matchLongOrder` is reached only by a
   * LONG taker, and a liquidation knows the side of the order it just wrote.
   *
   * Everything identifying is dropped here rather than in ws-server. The public
   * tape needs no authentication, so "no user ids on a print" has to be a
   * property of the payload the engine emits, not a rule the broadcaster is
   * trusted to remember.
   */
  const tradesFromFills = (
    fills: FillRecordNumberified[],
    takerPositionType: TPositionType,
    ts = Date.now(),
  ): TTradePrintSchema[] =>
    fills.map((fill) => ({
      id: fill.id!,
      price: `${fill.price}`,
      qty: `${fill.qty}`,
      side: takerPositionType === "LONG" ? ("buy" as const) : ("sell" as const),
      ts,
    }));

  const getUserById = (userId: string) => {
    return store.users.get(userId);
  };

  /* ------------------------------------------------ the private channel -- */

  /**
   * Merge one user-event map into another, in place.
   *
   * A liquidation sweep produces one map per forced close and they routinely
   * concern the same account twice — the liquidated user and, on the next
   * position, a maker who is the same person. Concatenating rather than
   * replacing is what keeps the second batch from erasing the first.
   */
  const mergeUserEvents = (into: TWsUserSchema, from: TWsUserSchema) => {
    for (const [userId, events] of Object.entries(from)) {
      if (!events.length) continue;
      (into[userId] ??= []).push(...events);
    }
    return into;
  };

  /**
   * An order row as the private channel carries it. Strings, and no Dates.
   *
   * **`filledQty` is passed in, never read off `order`.** `order` here is
   * `normalizedPayload`, which is the Postgres row the backend inserted before
   * the engine saw it — so its `filledQty` is the `"0"` it was created with and
   * nothing ever increments it. The executed quantity lives in the match
   * function's own accumulator, which is what the API reply already reports.
   *
   * Reading the row instead would have shipped a sixth instance of the bug
   * this engine has produced five times (`orders.price` in Phase 7,
   * `orders.filledQty` in Phase 8, `orders.initialMargin` in Phase 9,
   * `currentOrder.filledQty` in Phase 10): **one quantity with two
   * representations, and the wrong one used.** The visible symptom here would
   * have been a partially filled resting order arriving with
   * `status: "partially_filled"` beside `filledQty: "0"` — a row that
   * contradicts itself in two adjacent columns.
   *
   * `status` IS read off the row, because the match functions mutate it in
   * place and it is therefore the engine's own value already.
   */
  const userOrderFrom = (
    order: OrderRecordNumberified,
    filledQty: number,
  ): TUserOrderSchema => ({
    id: order.id,
    marketId: order.marketId,
    positionType: order.positionType,
    orderType: order.orderType,
    status: order.status,
    qty: `${order.qty}`,
    filledQty: `${filledQty}`,
    price: `${order.price}`,
    slippage: Number(order.slippage),
    initialMargin: `${order.initialMargin}`,
    createdAt: new Date(order.createdAt ?? Date.now()).toISOString(),
  });

  /**
   * The two absolute facts every affected account is told at the end of a
   * reply: what it now holds in this market, and what its collateral now is.
   *
   * Both are read out of the store rather than derived from the trade, and
   * both are sent even when they happen not to have moved. A client that has
   * to work out whether an event implies a balance change is a second copy of
   * the engine's accounting, and it would be the copy that is wrong.
   *
   * `position: null` is a real answer — the position was closed or netted
   * flat — and is what removes the row from the Positions tab.
   */
  const stateEventsFor = (userId: string, marketId: string): TUserEventSchema[] => {
    const user = getUserById(userId);
    if (!user) return [];

    const held = getUserMarketPosition(user.positions, marketId);
    return [
      {
        type: "position",
        marketId,
        position: held
          ? {
              marketId,
              type: held.position.type,
              qty: `${held.position.qty}`,
              margin: `${held.position.margin}`,
              averagePrice: `${held.position.averagePrice}`,
              liquidationPrice: `${held.position.liquidationPrice}`,
            }
          : null,
      },
      {
        type: "balance",
        available: `${user.collateral.available}`,
        locked: `${user.collateral.locked}`,
      },
    ];
  };

  /**
   * Everything one match should tell the accounts it touched.
   *
   * The taker's side is passed in for the same reason `tradesFromFills` needs
   * it: a fill row names two accounts and records no direction at all, so
   * "which side was I on" is knowable only here, inside the match. The maker
   * is always the mirror of the taker.
   *
   * The event order within a user's batch is deliberate — `order.new` before
   * `order.update` before `fill`, then the two absolute state events last — so
   * a client applying the batch in order never patches a row it has not
   * inserted yet, and finishes on the truth rather than on an inference.
   */
  const userEventsForMatch = ({
    marketId,
    fills,
    takerSide,
    orderUpdates,
    newOrders = [],
    ts = Date.now(),
  }: {
    marketId: string;
    fills: FillRecordNumberified[];
    takerSide: TPositionType;
    orderUpdates: TOrderDataForWriterSchema[];
    /** Orders that came into existence in this reply, with what they filled. */
    newOrders?: {
      order: OrderRecordNumberified;
      filledQty: number;
      origin: "user" | "liquidation";
    }[];
    ts?: number;
  }): TWsUserSchema => {
    const events: TWsUserSchema = {};
    const push = (userId: string, event: TUserEventSchema) => {
      (events[userId] ??= []).push(event);
    };
    const touched = new Set<string>();

    for (const { order, filledQty, origin } of newOrders) {
      touched.add(order.userId);
      push(order.userId, {
        type: "order.new",
        order: userOrderFrom(order, filledQty),
        origin,
      });
    }

    for (const update of orderUpdates) {
      touched.add(update.userId);
      push(update.userId, {
        type: "order.update",
        orderId: update.orderId,
        marketId,
        status: update.status,
        filledQty: `${update.filledQty}`,
      });
    }

    for (const fill of fills) {
      touched.add(fill.makerId);
      touched.add(fill.takerId);

      push(fill.takerId, {
        type: "fill",
        fillId: fill.id!,
        orderId: fill.takerOrderId,
        marketId,
        side: takerSide,
        role: "taker",
        price: `${fill.price}`,
        qty: `${fill.qty}`,
        ts,
      });
      push(fill.makerId, {
        type: "fill",
        fillId: fill.id!,
        orderId: fill.makerOrderId,
        marketId,
        side: takerSide === "LONG" ? "SHORT" : "LONG",
        role: "maker",
        price: `${fill.price}`,
        qty: `${fill.qty}`,
        ts,
      });
    }

    for (const userId of touched) {
      for (const event of stateEventsFor(userId, marketId)) {
        push(userId, event);
      }
    }

    return events;
  };

  const getRoudedNumber = (numberToRound: number) => {
    return +numberToRound.toFixed(2);
  };

  const getUserMarketPosition = (positions: TPosition[], marketId: string) => {
    const positionIndex = positions.findIndex(
      (pos) => pos.marketId === marketId,
    );
    return positionIndex === -1
      ? null
      : { positionIndex, position: positions[positionIndex]! };
  };

  const calculateRelativeMargin = (
    totalMargin: number,
    totalQty: number,
    filledQty: number,
  ) => {
    return getRoudedNumber((totalMargin / totalQty) * filledQty);
  };

  type TPriceData = { qty: number; price: number };
  const calculateWeightedAveragePrice = (
    pastData: TPriceData,
    newData: TPriceData,
  ) => {
    const pastTotal = pastData.qty * pastData.price;
    const newTotal = newData.qty * newData.price;
    const totalPrice = pastTotal + newTotal;
    const totalQty = pastData.qty + newData.qty;

    return getRoudedNumber(totalPrice / totalQty);
  };

  const calculateLiquidationPrice = ({
    margin,
    qty,
    type,
    averagePrice,
  }: {
    margin: number;
    qty: number;
    type: TPositionType;
    averagePrice: number;
  }) => {
    // liquidationPrice wud need to be calculated through
    /**
     * margin = 25
     * Maintenance Margin = 10%
     * Max Allowed Loss = 25 - 2.50 (10% of margin) = 22.50
     * liquidationPrice = averagePrice -/+ (Max Allowed Loss/qty)
     *                                  ^ depending on if it is LONG - or SHORT +
     */
    // there's a buffer of 10% b/w total bankruptcy price and liquidation price
    const maintenanceMarginPercentage = 0.01; // 10%
    const maintenanceMarginAmt = maintenanceMarginPercentage * margin;

    const maxAllowedLoss = margin - maintenanceMarginAmt;
    const maxAllowedLossPerUnit = maxAllowedLoss / qty;

    return type === "LONG"
      ? getRoudedNumber(averagePrice - maxAllowedLossPerUnit)
      : getRoudedNumber(averagePrice + maxAllowedLossPerUnit);
  };
  const createPosition = (
    user: TUser,
    payload: Omit<TPosition, "liquidationPrice">,
    lastTradedPrice: number,
  ) => {
    // { market: "SOL", type: "LONG", qty: 10, margin: 500, liquidationPrice: 80, averagePrice: 90 },
    // one market can have only one entry in positions - this is called One-Way Position Netting

    const { marketId, type, qty, margin, averagePrice } = payload;

    const existingPositionData = getUserMarketPosition(
      user.positions,
      marketId,
    );
    if (!existingPositionData) {
      const liquidationPrice = calculateLiquidationPrice({
        margin,
        qty,
        type,
        averagePrice,
      });
      const newPosition: TPosition = { ...payload, liquidationPrice };
      user.positions.push(newPosition);
      return newPosition;
    } else {
      // existingPosition exists

      const { positionIndex, position: existingPosition } =
        existingPositionData;

      if (existingPosition.type !== type) {
        // existingPosition.type was the opposite of the new incoming type, so this is a candidate for one-way position netting
        const updatedQuantity = existingPosition.qty - qty;
        const absUpdatedQuantity = Math.abs(updatedQuantity);
        const newAveragePrice = calculateWeightedAveragePrice(
          {
            qty: existingPosition.qty,
            price: existingPosition.averagePrice,
          },
          { qty: absUpdatedQuantity, price: averagePrice },
        );

        const currentTotalPrice = lastTradedPrice * qty;
        const newTotalPrice = newAveragePrice * qty;
        let pnLAfterNetting =
          existingPosition.type === "LONG"
            ? currentTotalPrice - newTotalPrice
            : newTotalPrice - currentTotalPrice;
        // ^ when long, the lastTradedPrice should've moved up if profit and down if loss. so keeping it FIRST would make the pnL that, either +ve for profit or -ve for loss. whereas if short, the lastTradedPrice should've moved down if profit and up if loss. so keeping it SECOND would make the pnL that, either +ve for profit or -ve for loss.

        let marginNeededAfterNetting: number | false = false;
        if (updatedQuantity === 0) {
          marginNeededAfterNetting = existingPosition.margin;

          // remove the existingPosition
          // td:: this position needs to be written to a db table as it is being closed. for now just pushing it to user's closed position's array but this can grow rapidly with activity so need to push this data to db table later via redis events and then db writer picks it up
          // td:: closed postion should have extra data, have spread existingPosition so that keys don't get updated from below but still it might need more data points
          user.closedPositions.push({
            ...existingPosition,
            exitType: "MANUAL",
          });
          user.positions.splice(positionIndex, 1);
        } else if (updatedQuantity > 0) {
          // existingPosition had greater qty

          // less qty was settled than what the user has open, so relatively deduct locked margin
          marginNeededAfterNetting = calculateRelativeMargin(
            existingPosition.margin,
            existingPosition.qty,
            absUpdatedQuantity,
          );
        } else if (updatedQuantity < 0) {
          // new qty is more, so switch types, i.e. LONG becomes SHORT or SHORT becomes LONG
          existingPosition.type = type;

          marginNeededAfterNetting = calculateRelativeMargin(
            margin, // <- margin should not be 0 in this case as i have a validation for it in placeOrder identifying this as a risk increasing order and throwing
            qty,
            absUpdatedQuantity,
          );
        }
        if (
          marginNeededAfterNetting !== false &&
          typeof marginNeededAfterNetting === "number"
        ) {
          // td:: seems, this user balance update would correctly only work in case updatedQuantity === 0. think through other cases
          user.collateral.available +=
            pnLAfterNetting + marginNeededAfterNetting;
          user.collateral.locked -= marginNeededAfterNetting;
          existingPosition.margin = marginNeededAfterNetting;
        }

        existingPosition.averagePrice = newAveragePrice;
        existingPosition.qty = absUpdatedQuantity;
        existingPosition.pnL = pnLAfterNetting;
      } else {
        const updatedQuantity = existingPosition.qty + qty;
        const newAveragePrice = calculateWeightedAveragePrice(
          {
            qty: existingPosition.qty,
            price: existingPosition.averagePrice,
          },
          { qty: updatedQuantity, price: averagePrice },
        );
        existingPosition.averagePrice = newAveragePrice;
        existingPosition.qty = updatedQuantity;
        existingPosition.margin += margin;
      }

      existingPosition.liquidationPrice = calculateLiquidationPrice({
        margin: existingPosition.margin,
        qty: existingPosition.qty,
        type,
        averagePrice: existingPosition.averagePrice,
      });

      return existingPosition;
    }
  };

  const updateUnrealisedPnLForAllUsers = (
    lastTradedPrice: number,
    marketId: string,
  ) => {
    for (const user of store.users.values()) {
      const userMarketPosition = user.positions.find(
        (p) => p.marketId === marketId,
      );
      if (!userMarketPosition) continue;

      // { market: "SOL", type: "LONG", qty: 10, margin: 500, liquidationPrice: 80, averagePrice: 90 },

      const pnL =
        userMarketPosition.type === "LONG"
          ? (lastTradedPrice - userMarketPosition.averagePrice) *
            userMarketPosition.qty
          : (userMarketPosition.averagePrice - lastTradedPrice) *
            userMarketPosition.qty;
      userMarketPosition.pnL = getRoudedNumber(pnL);
    }
  };

  type TMatchOrderFunctionResponse = {
    backend: {
      orderId: string;
      status: TOrderStatusesEnum;
      filledQty: number;
      totalPrice: number;
      averagePrice: number;
      fills: FillRecordNumberified[];
    } | null;
    writer: TWriterSchema;
  };

  const matchLongOrder = (
    currentOrder: OrderRecordNumberified,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestAskPrice(orderbook.asks);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;

    const orderUpdatesForWriter: TOrderDataForWriterSchema[] = [];
    const fillsForCurrentOrder: FillRecordNumberified[] = [];
    while (
      remainingQty > 0 &&
      bestNextPrice &&
      bestNextPrice <= currentOrder.price
    ) {
      const asks = orderbook.asks[`${bestNextPrice}`]!;
      if (asks.availableQty <= 0) {
        // should not occur i think, 'cause i remove the empty prices
        bestNextPrice = getNextBestAskPrice(orderbook.asks, bestNextPrice);
        continue;
      }

      let firstOrderData = getFirstCreatedOrder(asks.openOrders);
      while (firstOrderData) {
        let shouldBreak = false;
        const { orderIndex: restingOpenOrderIndex, order: restingOpenOrder } =
          firstOrderData;
        const availableQty = restingOpenOrder.qty - restingOpenOrder.filledQty;

        const fill: FillRecordNumberified = {
          /**
           * Minted here rather than left to Postgres' `defaultRandom()`.
           *
           * The public print carries this id, so the trade on the tape and the
           * row it becomes in the account's Fills tab are the same identity
           * rather than two records of one event that nothing can join. It also
           * gives the tape a stable React key that does not have to be
           * synthesised from a maker/taker order pair.
           */
          id: crypto.randomUUID(),
          makerId: restingOpenOrder.userId,
          takerId: userForCurrentOrder.userId,
          marketId: currentOrder.marketId,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          makerOrderId: restingOpenOrder.orderId,
          takerOrderId: currentOrder.id,
        };
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const matchedRestingOrder: TOpenOrder = restingOpenOrder;

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          asks.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          matchedRestingOrder.status = "partially_filled";

          remainingQty = 0;
          shouldBreak = true;
        } else if (availableQty === remainingQty) {
          // the current order can be filled - restingOrder is filled
          fill.qty = remainingQty;
          asks.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          matchedRestingOrder.status = "filled";

          // as the resting open order is filled, splice it out
          asks.openOrders.splice(restingOpenOrderIndex, 1);
          if (asks.availableQty <= 0) {
            delete orderbook.asks[`${bestNextPrice}`];
          }

          remainingQty = 0;
          shouldBreak = true;
        } else {
          // availableQty < remainingQty
          // the current order can be partially filled - restingOrder is filled
          remainingQty -= availableQty;
          fill.qty = availableQty;
          asks.availableQty -= availableQty;

          filledQtyForCurrentOrder += availableQty;
          totalPriceForCurrentOrder += bestNextPrice * availableQty;
          currentOrder.status = "partially_filled";

          restingOpenOrder.filledQty += availableQty;

          matchedRestingOrder.status = "filled";

          asks.openOrders.splice(restingOpenOrderIndex, 1);
          if (asks.availableQty <= 0) {
            delete orderbook.asks[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMarginForFilledQty = calculateRelativeMargin(
          matchedRestingOrder.margin,
          matchedRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            marketId: matchedRestingOrder.marketId,
            type: matchedRestingOrder.positionType,
            qty: fill.qty,
            margin: relativeMarginForFilledQty,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        // update restingOpenOrder's margin also so that it reflects the current state of margin locked for the open order
        const relativeMarginForRemainingQtyOfRestingOrder =
          calculateRelativeMargin(
            restingOpenOrder.margin,
            availableQty,
            availableQty - fill.qty,
          );
        restingOpenOrder.margin = relativeMarginForRemainingQtyOfRestingOrder;

        orderUpdatesForWriter.push({
          orderId: matchedRestingOrder.orderId,
          userId: matchedRestingOrder.userId,
          status: matchedRestingOrder.status,
          filledQty: restingOpenOrder.filledQty,
        });

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(asks.openOrders);
      }

      bestNextPrice = getNextBestAskPrice(orderbook.asks, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    const relativeMarginForFilledQty = calculateRelativeMargin(
      currentOrder.initialMargin,
      currentOrder.qty,
      filledQtyForCurrentOrder,
    );
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      createPosition(
        userForCurrentOrder,
        {
          marketId: currentOrder.marketId,
          type: currentOrder.positionType,
          qty: filledQtyForCurrentOrder,
          margin: relativeMarginForFilledQty,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.marketId,
      );
    }

    if (remainingQty > 0) {
      if (currentOrder.orderType === "limit") {
        if (currentOrder.status === "pending") {
          currentOrder.status = "open";
        }
        const relativeMarginForRemainingQty = calculateRelativeMargin(
          currentOrder.initialMargin,
          currentOrder.qty,
          remainingQty,
        );
        // add an open order for this user for the currentOrder.price in the bids
        const newOpenOrder: TOpenOrder = {
          userId: userForCurrentOrder.userId,
          qty: currentOrder.qty,
          filledQty: filledQtyForCurrentOrder,
          orderId: currentOrder.id,
          marketId: currentOrder.marketId,
          positionType: currentOrder.positionType,
          margin: relativeMarginForRemainingQty,
          status: "open",
          createdAt: new Date(),
        };

        const bids = orderbook.bids[`${currentOrder.price}`];
        const additionalAvailableQty =
          currentOrder.qty - filledQtyForCurrentOrder;
        if (!bids) {
          orderbook.bids[`${currentOrder.price}`] = {
            availableQty: additionalAvailableQty,
            openOrders: [newOpenOrder],
          };
        } else {
          bids.availableQty += additionalAvailableQty;
          bids.openOrders.push(newOpenOrder);
        }
      } else {
        // currentOrder.orderType = "market"
        // cancel the remaining order
        currentOrder.status = "cancelled";
      }
    }
    orderUpdatesForWriter.push({
      orderId: currentOrder.id,
      userId: currentOrder.userId,
      status: currentOrder.status,
      /**
       * `filledQtyForCurrentOrder`, NOT `currentOrder.filledQty`.
       *
       * `currentOrder` is the row the backend inserted before the engine saw
       * it, so its `filledQty` is the `"0"` that row was created with and is
       * never incremented — the executed quantity is accumulated in the local
       * above, which is what the backend reply and the in-memory open order
       * both already use. Persisting the row's own field wrote `0` to Postgres
       * for every order that took liquidity, so an aggressive order came to
       * rest as `status: "filled", filledQty: 0` — visible the moment Phase 10
       * put a finished order's Filled column on screen.
       *
       * Same shape as the Phase 7, 8 and 9 defects: one quantity with two
       * representations, and the wrong one persisted.
       */
      filledQty: filledQtyForCurrentOrder,
    });

    return {
      backend: {
        orderId: currentOrder.id,
        status: currentOrder.status,
        filledQty: filledQtyForCurrentOrder,
        totalPrice: totalPriceForCurrentOrder,
        averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        fills: fillsForCurrentOrder,
      },
      writer: [
        {
          table: "fills",
          data: fillsForCurrentOrder.map((f) => stringifyFill(f)),
        },
        {
          table: "order_updates",
          data: orderUpdatesForWriter,
        },
      ],
    };
  };

  const matchShortOrder = (
    currentOrder: OrderRecordNumberified,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestBidPrice(orderbook.bids);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;

    const orderUpdatesForWriter: TOrderDataForWriterSchema[] = [];
    const fillsForCurrentOrder: FillRecordNumberified[] = [];
    while (
      remainingQty > 0 &&
      bestNextPrice &&
      bestNextPrice >= currentOrder.price
    ) {
      const bids = orderbook.bids[`${bestNextPrice}`]!;
      if (bids.availableQty <= 0) {
        // should not occur i think, 'cause i remove the empty prices
        bestNextPrice = getNextBestBidPrice(orderbook.bids, bestNextPrice);
        continue;
      }

      let firstOrderData = getFirstCreatedOrder(bids.openOrders);
      while (firstOrderData) {
        let shouldBreak = false;
        const { orderIndex: restingOpenOrderIndex, order: restingOpenOrder } =
          firstOrderData;
        const availableQty = restingOpenOrder.qty - restingOpenOrder.filledQty;

        const fill: FillRecordNumberified = {
          /** Minted here, not by Postgres — see the LONG match above. */
          id: crypto.randomUUID(),
          makerId: restingOpenOrder.userId,
          takerId: userForCurrentOrder.userId,
          marketId: currentOrder.marketId,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          makerOrderId: restingOpenOrder.orderId,
          takerOrderId: currentOrder.id,
        };
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const matchedRestingOrder: TOpenOrder = restingOpenOrder;

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          bids.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          matchedRestingOrder.status = "partially_filled";

          remainingQty = 0;
          shouldBreak = true;
        } else if (availableQty === remainingQty) {
          // the current order can be filled - restingOrder is filled
          fill.qty = remainingQty;
          bids.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          matchedRestingOrder.status = "filled";

          // as the resting open order is filled, splice it out
          bids.openOrders.splice(restingOpenOrderIndex, 1);
          if (bids.availableQty <= 0) {
            delete orderbook.bids[`${bestNextPrice}`];
          }

          remainingQty = 0;
          shouldBreak = true;
        } else {
          // availableQty < remainingQty
          // the current order can be partially filled - restingOrder is filled
          remainingQty -= availableQty;
          fill.qty = availableQty;
          bids.availableQty -= availableQty;

          filledQtyForCurrentOrder += availableQty;
          totalPriceForCurrentOrder += bestNextPrice * availableQty;
          currentOrder.status = "partially_filled";

          restingOpenOrder.filledQty += availableQty;

          matchedRestingOrder.status = "filled";

          bids.openOrders.splice(restingOpenOrderIndex, 1);
          if (bids.availableQty <= 0) {
            delete orderbook.bids[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMarginForFilledQty = calculateRelativeMargin(
          matchedRestingOrder.margin,
          matchedRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            marketId: matchedRestingOrder.marketId,
            type: matchedRestingOrder.positionType,
            qty: fill.qty,
            margin: relativeMarginForFilledQty,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        // update restingOpenOrder's margin also so that it reflects the current state of margin locked for the open order
        const relativeMarginForRemainingQtyOfRestingOrder =
          calculateRelativeMargin(
            restingOpenOrder.margin,
            availableQty,
            availableQty - fill.qty,
          );
        restingOpenOrder.margin = relativeMarginForRemainingQtyOfRestingOrder;

        orderUpdatesForWriter.push({
          orderId: matchedRestingOrder.orderId,
          userId: matchedRestingOrder.userId,
          status: matchedRestingOrder.status,
          filledQty: restingOpenOrder.filledQty,
        });

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(bids.openOrders);
      }

      bestNextPrice = getNextBestBidPrice(orderbook.bids, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    const relativeMarginForFilledQty = calculateRelativeMargin(
      currentOrder.initialMargin,
      currentOrder.qty,
      filledQtyForCurrentOrder,
    );
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      createPosition(
        userForCurrentOrder,
        {
          marketId: currentOrder.marketId,
          type: currentOrder.positionType,
          qty: filledQtyForCurrentOrder,
          margin: relativeMarginForFilledQty,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.marketId,
      );
    }

    if (remainingQty > 0) {
      if (currentOrder.orderType === "limit") {
        const relativeMarginForRemainingQty = calculateRelativeMargin(
          currentOrder.initialMargin,
          currentOrder.qty,
          remainingQty,
        );
        // add an open order for this user for the currentOrder.price in the asks
        const newOpenOrder: TOpenOrder = {
          userId: userForCurrentOrder.userId,
          qty: currentOrder.qty,
          filledQty: filledQtyForCurrentOrder,
          orderId: currentOrder.id,
          marketId: currentOrder.marketId,
          positionType: currentOrder.positionType,
          margin: relativeMarginForRemainingQty,
          status: "open",
          createdAt: new Date(),
        };

        const asks = orderbook.asks[`${currentOrder.price}`];
        const additionalAvailableQty =
          currentOrder.qty - filledQtyForCurrentOrder;
        if (!asks) {
          orderbook.asks[`${currentOrder.price}`] = {
            availableQty: additionalAvailableQty,
            openOrders: [newOpenOrder],
          };
        } else {
          asks.availableQty += additionalAvailableQty;
          asks.openOrders.push(newOpenOrder);
        }
      } else {
        // currentOrder.orderType = "market"
        // cancel the remaining order
        currentOrder.status = "cancelled";
      }
    }

    orderUpdatesForWriter.push({
      orderId: currentOrder.id,
      userId: currentOrder.userId,
      status: currentOrder.status,
      /**
       * `filledQtyForCurrentOrder`, NOT `currentOrder.filledQty`.
       *
       * `currentOrder` is the row the backend inserted before the engine saw
       * it, so its `filledQty` is the `"0"` that row was created with and is
       * never incremented — the executed quantity is accumulated in the local
       * above, which is what the backend reply and the in-memory open order
       * both already use. Persisting the row's own field wrote `0` to Postgres
       * for every order that took liquidity, so an aggressive order came to
       * rest as `status: "filled", filledQty: 0` — visible the moment Phase 10
       * put a finished order's Filled column on screen.
       *
       * Same shape as the Phase 7, 8 and 9 defects: one quantity with two
       * representations, and the wrong one persisted.
       */
      filledQty: filledQtyForCurrentOrder,
    });

    return {
      backend: {
        orderId: currentOrder.id,
        status: currentOrder.status,
        filledQty: filledQtyForCurrentOrder,
        totalPrice: totalPriceForCurrentOrder,
        averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        fills: fillsForCurrentOrder,
      },
      writer: [
        {
          table: "fills",
          data: fillsForCurrentOrder.map((f) => stringifyFill(f)),
        },
        {
          table: "order_updates",
          data: orderUpdatesForWriter,
        },
      ],
    };
  };

  const matchOrder = (
    order: OrderRecordNumberified,
    orderbook: TOrderbook,
    user: TUser,
  ) => {
    // matchLimitLongOrder && matchMarketLongOrder are identical. similar to matchLimitShortOrder && matchMarketShortOrder
    // * the first diff is that the first while loop has an extra condition which validates the order should be matched only till the bestNextPrice is less than or equal to currentOrder.price, 'cause limit order can be matched to better prices but not worse versus there is no such limit on market orders. they keep matching until there is a next price.
    // * secondly, if there is any remainingQty left, for limit orders, an orderbook entry is created for that price vs the order is cancelled for market orders
    // --------- tmerged into one via slippage

    let res: TMatchOrderFunctionResponse | null = null;
    if (order.positionType === "LONG") {
      res = matchLongOrder(order, orderbook, user);
    } else {
      res = matchShortOrder(order, orderbook, user);
    }

    // console.dir(store, { depth: 10 });
    if (res !== null) {
      return res;
    }

    return null;
  };

  const placeOrder = (
    payload: SelectOrderRecord,
    skipWebSocketPayload = false,
  ) => {
    let { userId, marketId, positionType, orderType, price, initialMargin } =
      payload;

    const normalizedPayload: OrderRecordNumberified = {
      ...payload,
      status: "open",
      qty: Number(payload.qty),
      filledQty: Number(payload.filledQty),
      price: Number(payload.price),
      slippage: Number(payload.slippage),
      initialMargin: Number(payload.initialMargin),
    };

    const orderbook = store.orderbooks[marketId];
    if (!orderbook) {
      throw new Error(`Unsupported market symbol`);
    }

    const user = getUserById(userId);
    if (!user) {
      throw new Error("User details does not exist");
    }
    const existingPositionData = getUserMarketPosition(
      user.positions,
      marketId,
    );
    let isRiskReducingOrder = false;
    /**
     * `Number(initialMargin)`, not `initialMargin`.
     *
     * The payload is a Postgres row, so `initialMargin` is a STRING — and the
     * backend inserts `"0"` when the client omits `equity`, which is exactly
     * the risk-reducing case this branch exists to catch. `!"0"` is `false`, so
     * an order with no margin fell straight past every check in here.
     *
     * It reached a correct outcome for a close by luck: the `else if` below
     * catches an opposite-side order against an existing position and zeroes the
     * margin itself. But the two guarded errors were unreachable — no position
     * at all produced `leverage = price * qty / 0`, i.e. `Infinity`, and came
     * back as "Leverage not supported", which sends the caller looking at the
     * wrong thing entirely.
     */
    if (!Number(initialMargin)) {
      if (!existingPositionData) {
        throw new Error(
          `Margin required as there is no open position for this market`,
        );
      } else {
        if (
          existingPositionData.position.type === positionType ||
          existingPositionData.position.qty <
            normalizedPayload.qty - existingPositionData.position.qty
        ) {
          throw new Error(
            `Margin required as this is a risk increasing order for this market`,
          );
        }

        // reached here, means that this is a risk reducing order, i.e. it is an opposite side order to the existing one && the new qty is less than or equal to the final qty that'll remain, i.e.
        // qty = 50, existingPositionData.position.qty = 40 - in opposite side trade, final qty = 10
        // qty = 10, existingPositionData.position.qty = 40 - in opposite side trade, final qty = 30
        //  both the above final qty are less the the existing pos qty, so it is a risk reducing order
        //
        // qty = 90, existingPositionData.position.qty = 40 - in opposite side trade, final qty = 50
        // this is not a risk reducing order and in this case it wud've been caught above
        // figure out how much is the risk gonna be reduced by or what could be the opposite margin
        // making margin 0 as it is not required.
        isRiskReducingOrder = true;
        normalizedPayload.initialMargin = 0;

        // if (existingPositionData.position.qty === qty) {
        //   margin = existingPositionData.position.margin;
        // } else {
        //   // existingPositionData.position.qty > qty
        //   const qtyLeftAfter = existingPositionData.position.qty - qty;
        //   margin =
        //     (existingPositionData.position.margin /
        //       existingPositionData.position.qty) *
        //     qtyLeftAfter;
        // }
      }
    } else if (existingPositionData) {
      if (
        existingPositionData.position.type !== positionType &&
        existingPositionData.position.qty >=
          normalizedPayload.qty - existingPositionData.position.qty
      ) {
        // reached here, means that this is a risk reducing order, i.e. it is an opposite side order to the existing one && the new qty is more than or equal to existingPosition's qty
        // figure out how much is the risk gonna be reduced by or what could be the opposite margin
        isRiskReducingOrder = true;
        normalizedPayload.initialMargin = 0;
      }
    }

    // margin should've been defined by now
    // margin = margin!;

    if (user.collateral.available < normalizedPayload.initialMargin) {
      throw new Error(`User does not have available margin`);
    }

    // current price would be valid price for limit, else for market order get the next best price,
    // depending on wheather it is a LONG or a SHORT
    let entryPrice =
      orderType === "limit"
        ? price
        : positionType === "LONG"
          ? getNextBestAskPrice(orderbook.asks)
          : getNextBestBidPrice(orderbook.bids);
    if (!entryPrice) {
      throw new Error(`There are no matches available`);
    }

    // this sets the price to be the max allowed price, essentially converting a market order to a limit order
    if (orderType === "market") {
      // in case of LONG this'd be the next best ask price & in SHORT, this'll be the next best bid
      entryPrice = Number(entryPrice);

      // i need to calc the slippage on the best next price + or - depending on the direction
      const maxSlippageAllowed = normalizedPayload.slippage * 0.01 * entryPrice;
      if (positionType === "LONG") {
        entryPrice += maxSlippageAllowed;
      } else {
        entryPrice -= maxSlippageAllowed;
      }

      /**
       * The bound the matching loop reads.
       *
       * This used to assign `normalizedPayload.slippage` — the percent — which
       * is why market orders could not fill: `matchLongOrder` matches while
       * `bestNextPrice <= currentOrder.price`, so with `price` holding `1` no
       * ask above a dollar was ever reachable and every market order came back
       * `cancelled` with `filledQty: 0` after its margin had been locked. The
       * short side had the mirror problem against `>=`.
       *
       * Assigning the bounded entry price is what the comment above always
       * said this did: a market order is a limit order priced at the worst
       * price the trader has agreed to accept. It also makes the leverage
       * check below real — it was computing `slippage * qty / margin`, which
       * meant the cap was not enforced on market orders at all.
       *
       * `slippage` itself is untouched, so what the user asked for is still
       * what is persisted and echoed back.
       */
      normalizedPayload.price = entryPrice;
    }

    // verify if the margin given is within allowed range for the market
    const leverage = isRiskReducingOrder
      ? 0
      : (normalizedPayload.price * normalizedPayload.qty) /
        normalizedPayload.initialMargin;
    if (orderbook.allowedLeverage < leverage) {
      throw new Error(`Leverage not supported`);
    }

    if (!isRiskReducingOrder && normalizedPayload.initialMargin > 0) {
      user.collateral.available -= normalizedPayload.initialMargin;
      user.collateral.locked += normalizedPayload.initialMargin;
    }

    const matchingResp = matchOrder(normalizedPayload, orderbook, user);
    if (!matchingResp) return null;

    /**
     * The private channel's payload, built here rather than in ws-server.
     *
     * Everything it needs is in scope and nowhere else: the taker's side (a
     * fill row does not record one), the resting orders that were hit, and —
     * once `matchOrder` has returned — each affected account's collateral and
     * position *after* the trade. ws-server could not reconstruct any of it
     * from the writer payload without reimplementing the netting.
     *
     * `origin` distinguishes an order the account placed from one the engine
     * minted against it. `skipWebSocketPayload` is only ever true on the
     * liquidation path, which is what makes it the right thing to read here.
     */
    const wsUser = userEventsForMatch({
      marketId,
      fills: matchingResp.backend?.fills ?? [],
      takerSide: normalizedPayload.positionType,
      orderUpdates:
        matchingResp.writer.find((w) => w.table === "order_updates")?.data ?? [],
      newOrders: [
        {
          order: normalizedPayload,
          // The accumulator, not the row — see `userOrderFrom`.
          filledQty: matchingResp.backend?.filledQty ?? 0,
          origin: skipWebSocketPayload ? "liquidation" : "user",
        },
      ],
    });

    if (skipWebSocketPayload) {
      return { ...matchingResp, wsUser };
    }

    /**
     * Built AFTER the match, which is where it always should have been.
     *
     * This block used to sit above `matchOrder`, so every broadcast that
     * followed an order described the book as it was *before* that order
     * touched it: a resting limit order was published as a level that did not
     * exist yet, and a crossing trade published the price of the PREVIOUS
     * trade as `last-traded-price`. The price poller's ~1 Hz sweep republished
     * the truth a moment later, which is why this never looked broken for
     * longer than a second and why nothing caught it — but for that second the
     * terminal showed a book nobody could trade against.
     *
     * `lastUpdateId` is bumped here too, so the counter orders frames by when
     * the book actually changed.
     */
    store.lastUpdateId++;
    const wsServer = {
      depth: getMarketDepth(marketId),
      lastTradedPrice: `${orderbook.lastTradedPrice}`,
      indexPrice: `${orderbook.indexPrice}`,
      trades: tradesFromFills(
        matchingResp.backend?.fills ?? [],
        normalizedPayload.positionType,
      ),
    };

    return {
      backend: matchingResp.backend,
      writer: matchingResp.writer,
      wsServer,
      wsUser,
    };
  };
  type TCancelOrderReturnType = {
    backend: {
      order: SelectOrderRecord;
      cancelledQty: number;
      balances: {
        releasedMargin: number;
        available: number;
        locked: number;
      };
    };
    writer: TWriterSchema;
    wsServer: TWsServerSchema;
    wsUser: TWsUserSchema;
  };
  const cancelOrder = (order: SelectOrderRecord): TCancelOrderReturnType => {
    // if a risk reducing order was placed earlier, that'd not have the margin required for that as it was identified as risk reducing. but now if the user is cancelling the order that was supposed to be the earlier one with risk. so that should be considered. if that is being cancelled. waaaaiiiiiiiiit, the order isn't cancelled, the position is squared off. this endpoint is though specifically to cancel an order which is not yet position-ized, i.e. not yet matched and thus position is not yet created. so it should be straigt-forward.
    // td::cancel only what is sitting on the order book and not the positions PLUS revert the apt balances

    const orderbook = store.orderbooks[order.marketId];
    const user = getUserById(order.userId);
    if (!orderbook || !user) {
      throw new Error("Order not found");
    }

    /**
     * The side is chosen ONCE and every later mutation goes through `side`.
     *
     * This used to look the level up on the correct side and then unconditionally
     * `delete orderbook.asks[price]` in the cleanup below — in the LONG branch
     * too. Cancelling a resting bid therefore left the emptied bid level in the
     * book and, if an ask happened to sit at the same price, deleted somebody
     * else's liquidity instead. Holding one reference makes the pairing
     * structural rather than something the next edit has to remember.
     */
    const side = order.positionType === "LONG" ? orderbook.bids : orderbook.asks;
    const priceLevel = `${order.price}`;
    const orderbookRecord: TBid | undefined = side[priceLevel];

    if (
      !orderbookRecord ||
      orderbookRecord.availableQty <= 0 ||
      orderbookRecord.openOrders.length <= 0
    ) {
      throw new Error("Order not found");
    }
    const orderIndex = orderbookRecord.openOrders.findIndex(
      (o) => o.orderId === order.id,
    );
    if (orderIndex === -1) {
      throw new Error("Order not found");
    }

    // revert the locked margin
    const openOrder = orderbookRecord.openOrders[orderIndex]!;
    const releasedMargin = openOrder.margin;
    user.collateral.available += releasedMargin;
    user.collateral.locked -= releasedMargin;

    /**
     * The quantity coming off the level is the ENGINE's remaining quantity, not
     * the Postgres row's.
     *
     * `order` is the row the backend read before calling us, and its `filledQty`
     * is only as fresh as db-writer's last pass. Deriving the decrement from it
     * meant a partially filled resting order subtracted more than it was still
     * holding, driving `availableQty` negative and tripping the cleanup below
     * while other users' orders were still sitting on the level.
     */
    const remainingQty = openOrder.qty - openOrder.filledQty;

    // delete the order
    orderbookRecord.openOrders.splice(orderIndex, 1);
    orderbookRecord.availableQty -= remainingQty;
    if (
      orderbookRecord.availableQty <= 0 ||
      orderbookRecord.openOrders.length <= 0
    ) {
      delete side[priceLevel];
    }

    order.status = "cancelled";

    store.lastUpdateId++;
    const wsServer = {
      depth: getMarketDepth(order.marketId),
      lastTradedPrice: `${orderbook.lastTradedPrice}`,
      indexPrice: `${orderbook.indexPrice}`,
    };

    return {
      backend: {
        order,
        cancelledQty: remainingQty,
        balances: {
          releasedMargin,
          available: user.collateral.available,
          locked: user.collateral.locked,
        },
      },
      writer: [
        {
          table: "order_updates",
          data: [
            {
              orderId: order.id,
              userId: order.userId,
              filledQty: openOrder.filledQty,
              status: order.status,
            },
          ],
        },
      ],
      wsServer,
      /**
       * A cancel concerns exactly one account and produces no fill, so the
       * batch is the order's own transition plus the collateral that was just
       * released. It is pushed even though the canceller already has the HTTP
       * reply: this account may be signed in on a second device, and the whole
       * point of the channel is that state does not depend on who asked.
       */
      wsUser: userEventsForMatch({
        marketId: order.marketId,
        fills: [],
        takerSide: order.positionType,
        orderUpdates: [
          {
            orderId: order.id,
            userId: order.userId,
            filledQty: openOrder.filledQty,
            status: order.status,
          },
        ],
      }),
    };
  };

  /**
   * A user the engine has never seen has no positions — that is an answer, not
   * an error.
   *
   * This used to throw "User has no positions", which the backend turns into a
   * 400 and the browser into a failed panel. The engine's store is in-memory, so
   * an unknown user is reachable in the ordinary course of things: a restart, or
   * simply a positions request that lands before the balances request that
   * creates the row (`get_balances` and `init_balance` both create on read).
   * Every one of those cases means "no positions", and saying so is both true
   * and what the caller can act on.
   *
   * Deliberately does NOT create the user, unlike `get_balances`: a read of a
   * list should not have a side effect on the store.
   */
  const getOpenPositionsForMarket = (userId: string, marketId: string) => {
    const user = getUserById(userId);
    if (!user) {
      return { backend: { positions: [] } };
    }

    const marketPositions = user.positions.filter(
      (pos) => pos.marketId === marketId,
    );

    return {
      backend: { positions: marketPositions },
    };
  };

  /** Same reasoning as `getOpenPositionsForMarket` above. */
  const getClosedPositionsForMarket = (userId: string, marketId: string) => {
    const user = getUserById(userId);
    if (!user) {
      return { backend: { closedPositions: [] } };
    }

    const marketPositions = user.closedPositions.filter(
      (pos) => pos.marketId === marketId,
    );

    return {
      backend: { closedPositions: marketPositions },
    };
  };

  const liqudationChecks = (asset: TSupportedAssets, price: number) => {
    const marketId = store.supportedAssets[asset];
    const orderbook = store.orderbooks[marketId];

    /**
     * The index price, finally assigned.
     *
     * `price` is the spot price apps/price-poller just read off Binance, and it
     * is already what every liquidation below is evaluated against — but until
     * this line nothing ever wrote it to the book, so `orderbook.indexPrice`
     * stayed on the value the market was seeded with (85 / 1850 / 4930) for the
     * whole life of the process. Two things were reading that seed:
     *
     *  - the `mark-price` feed, which therefore broadcast a number that had
     *    never been true of anything (G15). The client's answer was to refuse
     *    to parse the frame at all;
     *  - `disperseFundingRate`, whose `(lastTraded − index) / index` was a
     *    ratio against a constant, so the hourly funding it applied to every
     *    open position was arithmetic on a made-up denominator.
     *
     * It changes nothing about who is liquidated: the loop below compares
     * against `price` directly and always has.
     */
    if (orderbook) orderbook.indexPrice = price;

    const allResponses: TMatchOrderFunctionResponse[] = [];
    /**
     * A forced close is a real trade and belongs on the public tape. It is
     * accumulated here rather than inside `arrayToObjectUtil`, because that
     * helper flattens the responses and by then the side of each liquidating
     * order — the one thing a print needs and a fill does not carry — is gone.
     */
    const liquidationTrades: TTradePrintSchema[] = [];
    /**
     * Merged across every forced close in this sweep. One tick can liquidate
     * several accounts and each of those trades against makers who may
     * themselves be liquidated later in the same loop, so this is a merge and
     * not an assignment — see `mergeUserEvents`.
     */
    const liquidationUserEvents: TWsUserSchema = {};

    for (const user of store.users.values()) {
      const posIndex = user.positions.findIndex(
        (pos) => pos.marketId === marketId,
      );
      if (posIndex === -1) continue;

      const userPosition = user.positions[posIndex]!;
      if (userPosition.type === "LONG") {
        if (userPosition.liquidationPrice >= price) {
          // liquidate this position
          const orderId = crypto.randomUUID();
          const newOrderData: SelectOrderRecord = {
            id: orderId,
            userId: user.userId,
            marketId: marketId,
            positionType: "SHORT",
            orderType: "market",
            status: "pending",
            qty: userPosition.qty.toString(),
            filledQty: "0",
            price: "0",
            slippage: 100,
            initialMargin: "0",
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          /**
           * One position that cannot be closed must not take the sweep down
           * with it.
           *
           * `placeOrder` throws when the opposite side of the book is empty
           * ("There are no matches available"), and a liquidation is a market
           * order against whatever is resting — so an empty book is an ordinary
           * outcome, not an exceptional one. Unguarded, that throw escaped
           * `liqudationChecks` and aborted the whole `spot_price_update`:
           * every other position in the market went unchecked, and the reply
           * carried no `wsServer` payload, so the depth, last-price and
           * mark-price feeds all stopped for that market until a tick arrived
           * with nothing to liquidate. A single stuck position could silence
           * the public feed indefinitely — which is exactly the failure this
           * phase is meant to make impossible.
           *
           * The position stays open. There is nothing else to do with it: it is
           * underwater and there is no liquidity to close it into. Leaving it
           * to the next tick is the honest outcome, and the next tick now
           * happens.
           */
          let resp: ReturnType<typeof placeOrder>;
          try {
            resp = placeOrder(newOrderData, true);
          } catch (error) {
            console.error(
              `liquidation skipped for ${marketId}:`,
              error instanceof Error ? error.message : error,
            );
            continue;
          }
          if (!resp || !resp?.writer) continue;
          liquidationTrades.push(
            ...tradesFromFills(
              resp.backend?.fills ?? [],
              newOrderData.positionType,
            ),
          );
          if (resp.wsUser) mergeUserEvents(liquidationUserEvents, resp.wsUser);
          resp?.writer.unshift({
            table: "order_inserts",
            data: [
              {
                ...newOrderData,
                createdAt: undefined,
                updatedAt: undefined,
              },
            ],
          });
          allResponses.push(resp);
        }
      } else {
        // SHORT position
        if (userPosition.liquidationPrice <= price) {
          // liquidate this position
          const orderId = crypto.randomUUID();
          const newOrderData: SelectOrderRecord = {
            id: orderId,
            userId: user.userId,
            marketId: marketId,
            positionType: "LONG",
            orderType: "market",
            status: "pending",
            qty: userPosition.qty.toString(),
            filledQty: "0",
            price: "0",
            slippage: 100,
            initialMargin: "0",
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          /** Same guard as the LONG branch above. */
          let resp: ReturnType<typeof placeOrder>;
          try {
            resp = placeOrder(newOrderData, true);
          } catch (error) {
            console.error(
              `liquidation skipped for ${marketId}:`,
              error instanceof Error ? error.message : error,
            );
            continue;
          }
          if (!resp || !resp?.writer) continue;
          liquidationTrades.push(
            ...tradesFromFills(
              resp.backend?.fills ?? [],
              newOrderData.positionType,
            ),
          );
          if (resp.wsUser) mergeUserEvents(liquidationUserEvents, resp.wsUser);
          resp?.writer.unshift({
            table: "order_inserts",
            data: [
              {
                ...newOrderData,
                createdAt: undefined,
                updatedAt: undefined,
              },
            ],
          });
          allResponses.push(resp);
        }
      }
    }

    let wsServer: TWsServerSchema | null = null;
    if (orderbook) {
      store.lastUpdateId++;
      wsServer = {
        depth: getMarketDepth(marketId),
        lastTradedPrice: `${orderbook.lastTradedPrice}`,
        indexPrice: `${orderbook.indexPrice}`,
        trades: liquidationTrades,
      };
    }

    const liquidationRes = arrayToObjectUtil(allResponses);
    return {
      backend: liquidationRes.backend,
      writer: liquidationRes.writer,
      wsServer,
      wsUser: liquidationUserEvents,
    };
  };

  const arrayToObjectUtil = (allResponses: TMatchOrderFunctionResponse[]) => {
    let streamableResposne: TMatchOrderFunctionResponse = {
      backend: null,
      writer: [],
    };
    type TIndividualWriter = TWriterSchema[number];
    let orderInserts: TIndividualWriter = {
      table: "order_inserts",
      data: [],
    };
    let orderUpdates: TIndividualWriter = {
      table: "order_updates",
      data: [],
    };
    let fillInserts: TIndividualWriter = {
      table: "fills",
      data: [],
    };
    allResponses.forEach((r) => {
      let orderInsert = r.writer.find((w) => w.table === "order_inserts");
      if (orderInsert) {
        orderInserts.data = [...orderInserts.data, ...orderInsert.data];
      }

      let orderUpdate = r.writer.find((w) => w.table === "order_updates");
      if (orderUpdate) {
        orderUpdates.data = [...orderUpdates.data, ...orderUpdate.data];
      }

      let fillInsert = r.writer.find((w) => w.table === "fills");
      if (fillInsert) {
        fillInserts.data = [...fillInserts.data, ...fillInsert.data];
      }
    });
    streamableResposne.writer = [orderInserts, orderUpdates, fillInserts];
    return streamableResposne;
  };

  const getCurrentFormattedDate = () => {
    const now = new Date();

    const year = now.getFullYear();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    return `${year}-${day}-${month}-${hours}-${minutes}`;
  };
  const backupStore = async (messageId: string) => {
    console.log("store", messageId);

    await uploadToS3(
      { messageId, store },
      `${getCurrentFormattedDate()}-store-backup`,
    );
  };

  const disperseFundingRate = () => {
    for (const user of store.users.values()) {
      for (const position of user.positions) {
        const marketId = position.marketId;
        const orderbook = store.orderbooks[marketId];
        if (!orderbook) {
          continue;
        }

        // if inflation rate is +, longs pay shorts, else shorts pay long
        const inflationRate =
          (orderbook.lastTradedPrice - orderbook.indexPrice) /
          orderbook.indexPrice;

        const notionalValue = position.qty * orderbook.lastTradedPrice;
        if (position.type === "LONG") {
          position.margin = position.margin - notionalValue * inflationRate;
        } else {
          position.margin = position.margin + notionalValue * inflationRate;
        }

        // update liquidation price
        position.liquidationPrice = calculateLiquidationPrice({
          margin: position.margin,
          averagePrice: position.averagePrice,
          qty: position.qty,
          type: position.type,
        });
      }
    }
  };

  const getMarketDepth = (marketId: string) => {
    const orderbook = store.orderbooks[marketId];
    if (!orderbook) {
      throw new Error(`Unsupported market symbol`);
    }

    const bids: [string, string][] = [];
    let bestNextPrice = getNextBestBidPrice(orderbook.bids);
    const maxDepth = 20;
    let iteration = 0;
    while (bestNextPrice && iteration < maxDepth) {
      iteration++;
      const { availableQty } = orderbook.bids[`${bestNextPrice}`]!;
      bids.push([`${bestNextPrice}`, `${availableQty}`]);
      bestNextPrice = getNextBestBidPrice(orderbook.bids, bestNextPrice);
    }

    const asks: [string, string][] = [];
    bestNextPrice = getNextBestAskPrice(orderbook.asks);
    iteration = 0;
    while (bestNextPrice && iteration < maxDepth) {
      iteration++;
      const { availableQty } = orderbook.asks[`${bestNextPrice}`]!;
      asks.push([`${bestNextPrice}`, `${availableQty}`]);
      bestNextPrice = getNextBestAskPrice(orderbook.asks, bestNextPrice);
    }

    return {
      market: marketId,
      lastUpdateId: store.lastUpdateId,
      timestamp: +new Date(),
      bids,
      asks,
    };
  };
  const getMarketDepthForAPI = (marketId: string) => {
    return { backend: getMarketDepth(marketId) };
  };

  //
  const handle = ({
    payload,
    type,
    messageId,
  }: Pick<TEngineRequestSchema, "payload" | "type"> & { messageId: string }):
    | Record<string, unknown>
    | undefined => {
    if (type === "init_balance") {
      const { userId } = payload as { userId: string };
      let user = getUserById(userId);
      if (!user) {
        user = {
          userId,
          collateral: { available: 0, locked: 0 },
          positions: [],
          closedPositions: [],
        };

        store.users.set(userId, user);
      }

      return {
        backend: { userId, balance: user.collateral.available },
      };
    } else if (type === "onramp") {
      const { userId, amount } = payload as { userId: string; amount: number };
      let user = getUserById(userId);
      if (!user) {
        user = {
          userId,
          collateral: { available: amount, locked: 0 },
          positions: [],
          closedPositions: [],
        };
        store.users.set(userId, user);
      } else {
        user.collateral.available += amount;
      }

      return {
        backend: { userId, available: user.collateral.available },
        /**
         * A deposit is the one balance change with no order and no fill
         * behind it, so it gets its own one-event batch. Without it the
         * deposit dialog would still have to refetch — and the account signed
         * in on a second device would never learn about the money at all.
         */
        wsUser: {
          [userId]: [
            {
              type: "balance",
              available: `${user.collateral.available}`,
              locked: `${user.collateral.locked}`,
            },
          ],
        } satisfies TWsUserSchema,
      };
    } else if (type === "create_order") {
      // code to init user if missing
      const { userId } = payload as { userId: string };
      let user = getUserById(userId);
      if (!user) {
        user = {
          userId,
          collateral: { available: 0, locked: 0 },
          positions: [],
          closedPositions: [],
        };

        store.users.set(userId, user);
      }
      const resp = placeOrder(payload as SelectOrderRecord);
      if (!resp) {
        throw new Error("Something went wrong");
      }
      return resp;
    } else if (type === "cancel_order") {
      const resp = cancelOrder(payload as SelectOrderRecord);
      // console.dir(store, { depth: 10 });
      return resp;
    } else if (type === "get_balances") {
      const { userId } = payload as { userId: string };
      let user = getUserById(userId);
      if (!user) {
        user = {
          userId,
          collateral: { available: 0, locked: 0 },
          positions: [],
          closedPositions: [],
        };

        store.users.set(userId, user);
      }
      return {
        backend: {
          balances: user.collateral,
        },
      };
    } else if (type === "get_open_positions_for_market") {
      const { userId, marketId } = payload as {
        userId: string;
        marketId: string;
      };
      return getOpenPositionsForMarket(userId, marketId);
    } else if (type === "get_closed_positions_for_market") {
      const { userId, marketId } = payload as {
        userId: string;
        marketId: string;
      };
      return getClosedPositionsForMarket(userId, marketId);
    } else if (type === "spot_price_update") {
      if (Object.hasOwn(payload, "SOL") && Number(payload["SOL"])) {
        return liqudationChecks("SOL", Number(payload["SOL"]));
      } else if (Object.hasOwn(payload, "BTC") && Number(payload["BTC"])) {
        return liqudationChecks("BTC", Number(payload["BTC"]));
      } else if (Object.hasOwn(payload, "ETH") && Number(payload["ETH"])) {
        return liqudationChecks("ETH", Number(payload["ETH"]));
      }
    } else if (type === "backup_store") {
      const { now } = payload as { now: string };
      const payloadNowDate = new Date(now);
      const safeOffsetMin = 10;
      const safeOffsetMills = safeOffsetMin * 60 * 1000;
      if (payloadNowDate > new Date(Date.now() - safeOffsetMills)) {
        backupStore(messageId);
      } else {
        // can be ignored as it is a past event that somehow engine didn't pickup up on time
      }
      return;
    } else if (type === "funding_rate_dispersal") {
      disperseFundingRate();
      return;
    } else if (type === "get_depth") {
      const { marketId } = payload as { marketId: string };

      return getMarketDepthForAPI(marketId);
    }
    throw new Error("Unsupported request type");
  };
  return { handle };
}

export type TEngine = ReturnType<typeof createEngine>;
export type TEngineHandler = Parameters<TEngine["handle"]>[0];
