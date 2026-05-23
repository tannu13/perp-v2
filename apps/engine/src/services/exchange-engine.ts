import type {
  TFill,
  TOpenOrder,
  TOrder,
  TOrderbook,
  TOrderType,
  TPosition,
  TPositionType,
  TStore,
  TUser,
} from "../store";
import { type TEngineRequestSchema } from "@repo/shared/redis-events";

export function createEngine(store: TStore) {
  // const onramp = (userId: number, amount: number) => {
  //   user.collateral.available += amount;
  //   return user.collateral.available;
  // };

  // for price priority
  const getNextBestAskPrice = (asks: TOrderbook["asks"], startFrom = -1) => {
    let minPrice = Infinity;

    for (const [price, ask] of Object.entries(asks)) {
      const currentPrice = Number(price);
      if (
        minPrice > currentPrice &&
        currentPrice > startFrom &&
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
        startFrom > currentPrice &&
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

  // const createOrder = (payload: Omit<TOrder, "orderId" | "status">) => {
  //   // { orderId: 1, market: "SOL", type: "LONG", qty: 10, margin: 500, orderType: "limit", price: 90, status: "filled" }
  //   const orderId = getNextOrderId();
  //   const { market, type, qty, margin, price, orderType } = payload;
  //   const order: TOrder = {
  //     ...payload,
  //     orderId,
  //     status: "open",
  //   };

  //   return order;
  // };

  const getUserOrderById = (user: TUser, orderId: number) => {
    const orderIndex = user.orders.findIndex(
      (order) => order.orderId === orderId,
    );

    return {
      orderIndex: orderIndex,
      order: user.orders[orderIndex]!,
    };
  };

  const createFill = ({
    maker,
    taker,
    market,
    qty,
    price,
    long,
    short,
  }: TFill) => {
    // { maker: 1, taker: 2, market: "SOL", qty: 10, price: 90, long: 1, short: 2}
    const fill: TFill = {
      maker,
      taker,
      market,
      qty,
      price,
      long,
      short,
    };

    store.fills.push(fill);
    return fill;
  };

  const getRoudedNumber = (numberToRound: number) => {
    return +numberToRound.toFixed(2);
  };

  const getUserMarketPosition = (positions: TPosition[], market: string) => {
    const positionIndex = positions.findIndex((pos) => pos.market === market);
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

    const { market, type, qty, margin, averagePrice } = payload;

    const existingPositionData = getUserMarketPosition(user.positions, market);
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
    market: string,
  ) => {
    const usersLen = store.users.length;
    for (let i = 0; i < usersLen; i++) {
      const user = store.users[i]!;

      const userMarketPosition = user.positions.find(
        (p) => p.market === market,
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
    filledQty: number;
    totalPrice: number;
    averagePrice: number;
    fills: TFill[];
  };
  /*
  const matchLimitLongOrder = (
    currentOrder: TOrder,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestAskPrice(orderbook.asks);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;
    const fillsForCurrentOrder: TFill[] = [];
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
        const fill = createFill({
          maker: restingOpenOrder.userId,
          taker: userForCurrentOrder.userId,
          market: currentOrder.market,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          long: userForCurrentOrder.userId,
          short: restingOpenOrder.userId,
        });
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const { order: userRestingOrder } = getUserOrderById(
          userOfRestingOpenOrder,
          restingOpenOrder.orderId,
        );

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          asks.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          userRestingOrder.status = "partially_filled";

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

          userRestingOrder.status = "filled";

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

          userRestingOrder.status = "filled";

          asks.openOrders.splice(restingOpenOrderIndex, 1);
          if (asks.availableQty <= 0) {
            delete orderbook.asks[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMargin = calculateRelativeMargin(
          userRestingOrder.margin,
          userRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            market: userRestingOrder.market,
            type: userRestingOrder.type,
            qty: fill.qty,
            margin: relativeMargin,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(asks.openOrders);
      }

      bestNextPrice = getNextBestAskPrice(orderbook.asks, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      const relativeMargin = calculateRelativeMargin(
        currentOrder.margin,
        currentOrder.qty,
        filledQtyForCurrentOrder,
      );
      createPosition(
        userForCurrentOrder,
        {
          market: currentOrder.market,
          type: currentOrder.type,
          qty: filledQtyForCurrentOrder,
          margin: relativeMargin,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.market,
      );
    }

    if (remainingQty > 0) {
      // add an open order for this user for the currentOrder.price in the bids
      const newOpenOrder: TOpenOrder = {
        userId: userForCurrentOrder.userId,
        qty: currentOrder.qty,
        filledQty: filledQtyForCurrentOrder,
        orderId: currentOrder.orderId,
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
    }

    return {
      filledQty: filledQtyForCurrentOrder,
      totalPrice: totalPriceForCurrentOrder,
      averagePrice: averagePriceForFilledQtyOfCurrentOrder,
      fills: fillsForCurrentOrder,
    };
  };

  const matchLimitShortOrder = (
    currentOrder: TOrder,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestBidPrice(orderbook.bids);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;
    const fillsForCurrentOrder: TFill[] = [];
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
        const fill = createFill({
          maker: restingOpenOrder.userId,
          taker: userForCurrentOrder.userId,
          market: currentOrder.market,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          long: restingOpenOrder.userId,
          short: userForCurrentOrder.userId,
        });
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const { order: userRestingOrder } = getUserOrderById(
          userOfRestingOpenOrder,
          restingOpenOrder.orderId,
        );

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          bids.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          userRestingOrder.status = "partially_filled";

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

          userRestingOrder.status = "filled";

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

          userRestingOrder.status = "filled";

          bids.openOrders.splice(restingOpenOrderIndex, 1);
          if (bids.availableQty <= 0) {
            delete orderbook.bids[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMargin = calculateRelativeMargin(
          userRestingOrder.margin,
          userRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            market: userRestingOrder.market,
            type: userRestingOrder.type,
            qty: fill.qty,
            margin: relativeMargin,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(bids.openOrders);
      }

      bestNextPrice = getNextBestBidPrice(orderbook.bids, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      const relativeMargin = calculateRelativeMargin(
        currentOrder.margin,
        currentOrder.qty,
        filledQtyForCurrentOrder,
      );
      createPosition(
        userForCurrentOrder,
        {
          market: currentOrder.market,
          type: currentOrder.type,
          qty: filledQtyForCurrentOrder,
          margin: relativeMargin,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.market,
      );
    }

    if (remainingQty > 0) {
      // add an open order for this user for the currentOrder.price in the bids
      const newOpenOrder: TOpenOrder = {
        userId: userForCurrentOrder.userId,
        qty: currentOrder.qty,
        filledQty: filledQtyForCurrentOrder,
        orderId: currentOrder.orderId,
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
    }

    return {
      filledQty: filledQtyForCurrentOrder,
      totalPrice: totalPriceForCurrentOrder,
      averagePrice: averagePriceForFilledQtyOfCurrentOrder,
      fills: fillsForCurrentOrder,
    };
  };

  const matchMarketLongOrder = (
    currentOrder: TOrder,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestAskPrice(orderbook.asks);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;
    const fillsForCurrentOrder: TFill[] = [];

    while (remainingQty > 0 && bestNextPrice) {
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
        const fill = createFill({
          maker: restingOpenOrder.userId,
          taker: userForCurrentOrder.userId,
          market: currentOrder.market,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          long: userForCurrentOrder.userId,
          short: restingOpenOrder.userId,
        });
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const { order: userRestingOrder } = getUserOrderById(
          userOfRestingOpenOrder,
          restingOpenOrder.orderId,
        );

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          asks.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          userRestingOrder.status = "partially_filled";

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

          userRestingOrder.status = "filled";

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

          userRestingOrder.status = "filled";

          asks.openOrders.splice(restingOpenOrderIndex, 1);
          if (asks.availableQty <= 0) {
            delete orderbook.asks[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMargin = calculateRelativeMargin(
          userRestingOrder.margin,
          userRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            market: userRestingOrder.market,
            type: userRestingOrder.type,
            qty: fill.qty,
            margin: relativeMargin,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(asks.openOrders);
      }

      bestNextPrice = getNextBestAskPrice(orderbook.asks, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      const relativeMargin = calculateRelativeMargin(
        currentOrder.margin,
        currentOrder.qty,
        filledQtyForCurrentOrder,
      );
      createPosition(
        userForCurrentOrder,
        {
          market: currentOrder.market,
          type: currentOrder.type,
          qty: filledQtyForCurrentOrder,
          margin: relativeMargin,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.market,
      );
    }

    if (remainingQty > 0 && !bestNextPrice) {
      // cancel the remaining order
      currentOrder.status = "cancelled";
    }

    return {
      filledQty: filledQtyForCurrentOrder,
      totalPrice: totalPriceForCurrentOrder,
      averagePrice: averagePriceForFilledQtyOfCurrentOrder,
      fills: fillsForCurrentOrder,
    };
  };

  const matchMarketShortOrder = (
    currentOrder: TOrder,
    orderbook: TOrderbook,
    userForCurrentOrder: TUser,
  ): TMatchOrderFunctionResponse => {
    let bestNextPrice = getNextBestBidPrice(orderbook.bids);
    let remainingQty = currentOrder.qty;
    // for creating an open order at the end if whole order was not filled
    let filledQtyForCurrentOrder = 0;
    // for position's average price
    let totalPriceForCurrentOrder = 0;
    const fillsForCurrentOrder: TFill[] = [];

    while (remainingQty > 0 && bestNextPrice) {
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
        const fill = createFill({
          maker: restingOpenOrder.userId,
          taker: userForCurrentOrder.userId,
          market: currentOrder.market,
          qty: 0, // <- will update it later in the conditionals
          price: bestNextPrice,
          long: restingOpenOrder.userId,
          short: userForCurrentOrder.userId,
        });
        fillsForCurrentOrder.push(fill);

        orderbook.lastTradedPrice = bestNextPrice;

        const userOfRestingOpenOrder = getUserById(restingOpenOrder.userId)!;
        const { order: userRestingOrder } = getUserOrderById(
          userOfRestingOpenOrder,
          restingOpenOrder.orderId,
        );

        if (availableQty > remainingQty) {
          // the current order can be filled - restingOrder is partially filled
          fill.qty = remainingQty;
          bids.availableQty -= remainingQty;

          filledQtyForCurrentOrder += remainingQty;
          totalPriceForCurrentOrder += bestNextPrice * remainingQty;
          currentOrder.status = "filled";

          restingOpenOrder.filledQty += remainingQty;

          userRestingOrder.status = "partially_filled";

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

          userRestingOrder.status = "filled";

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

          userRestingOrder.status = "filled";

          bids.openOrders.splice(restingOpenOrderIndex, 1);
          if (bids.availableQty <= 0) {
            delete orderbook.bids[`${bestNextPrice}`];
          }
        }

        // create positions for the user whose open order got matched
        const relativeMargin = calculateRelativeMargin(
          userRestingOrder.margin,
          userRestingOrder.qty,
          fill.qty,
        );
        createPosition(
          userOfRestingOpenOrder,
          {
            market: userRestingOrder.market,
            type: userRestingOrder.type,
            qty: fill.qty,
            margin: relativeMargin,
            averagePrice: bestNextPrice,
          },
          orderbook.lastTradedPrice,
        );

        if (shouldBreak) break;

        firstOrderData = getFirstCreatedOrder(bids.openOrders);
      }

      bestNextPrice = getNextBestBidPrice(orderbook.bids, bestNextPrice);
    }

    const averagePriceForFilledQtyOfCurrentOrder =
      filledQtyForCurrentOrder > 0
        ? getRoudedNumber(totalPriceForCurrentOrder / filledQtyForCurrentOrder)
        : 0;
    if (filledQtyForCurrentOrder > 0) {
      // create position for the current order user as they've got some / all matched
      const relativeMargin = calculateRelativeMargin(
        currentOrder.margin,
        currentOrder.qty,
        filledQtyForCurrentOrder,
      );
      createPosition(
        userForCurrentOrder,
        {
          market: currentOrder.market,
          type: currentOrder.type,
          qty: filledQtyForCurrentOrder,
          margin: relativeMargin,
          averagePrice: averagePriceForFilledQtyOfCurrentOrder,
        },
        orderbook.lastTradedPrice,
      );

      updateUnrealisedPnLForAllUsers(
        orderbook.lastTradedPrice,
        currentOrder.market,
      );
    }

    if (remainingQty > 0) {
      // cancel the remaining order
      currentOrder.status = "cancelled";
    }

    return {
      filledQty: filledQtyForCurrentOrder,
      totalPrice: totalPriceForCurrentOrder,
      averagePrice: averagePriceForFilledQtyOfCurrentOrder,
      fills: fillsForCurrentOrder,
    };
  };
*/
  // td:: ask if passing user ids around so that fills can be created is okay or should i be getting the open orders only from the matcher (and probably order indexes also to splice later) and do the updates outside
  const matchOrder = (order: TOrder, orderbook: TOrderbook, user: TUser) => {
    // td:: matchLimitLongOrder && matchMarketLongOrder are identical. similar to matchLimitShortOrder && matchMarketShortOrder
    // * the first diff is that the first while loop has an extra condition which validates the order should be matched only till the bestNextPrice is less than or equal to currentOrder.price, 'cause limit order can be matched to better prices but not worse versus there is no such limit on market orders. they keep matching until there is a next price.
    // * secondly, if there is any remainingQty left, for limit orders, an orderbook entry is created for that price vs the order is cancelled for market orders
    // --------- try to merge them down

    let res: TMatchOrderFunctionResponse | null = null;
    // if (order.orderType === "limit") {
    //   if (order.type === "LONG") {
    //     res = matchLimitLongOrder(order, orderbook, user);
    //   } else if (order.type === "SHORT") {
    //     res = matchLimitShortOrder(order, orderbook, user);
    //   }
    // } else if (order.orderType === "market") {
    //   if (order.type === "LONG") {
    //     res = matchMarketLongOrder(order, orderbook, user);
    //   } else if (order.type === "SHORT") {
    //     res = matchMarketShortOrder(order, orderbook, user);
    //   }
    // }

    // console.dir(store, { depth: 10 });
    // if (res !== null) {
    //   return {
    //     orderId: order.orderId,
    //     status: order.status,
    //     filledQty: res.filledQty,
    //     averagePrice: res.averagePrice,
    //     fills: res.fills,
    //   };
    // }

    return null;
  };

  /*
  const placeOrder = (userId: number, payload: TCreateOrderSchema) => {
    const { price, qty, equity, type, market, orderType } = payload;

    // changing equity to margin as it clicks more
    let margin = equity;

    const orderbook = store.orderbooks[market];
    if (!orderbook) {
      throw new Error(`Unsupported market symbol ${market}`);
    }

    const user = getUserById(userId)!;
    const existingPositionData = getUserMarketPosition(user.positions, market);
    let isRiskReducingOrder = false;
    if (!margin) {
      if (!existingPositionData) {
        throw new Error(
          `Margin required as there is no open position for market: ${market}`,
        );
      } else {
        if (
          existingPositionData.position.type === type ||
          existingPositionData.position.qty <
            qty - existingPositionData.position.qty
        ) {
          throw new Error(
            `Margin required as this is a risk increasing order for market: ${market}`,
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
        margin = 0;

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
        existingPositionData.position.type !== type &&
        existingPositionData.position.qty >=
          qty - existingPositionData.position.qty
      ) {
        // reached here, means that this is a risk reducing order, i.e. it is an opposite side order to the existing one && the new qty is more than or equal to existingPosition's qty
        // figure out how much is the risk gonna be reduced by or what could be the opposite margin
        isRiskReducingOrder = true;
        margin = 0;
      }
    }

    // margin should've been defined by now
    // margin = margin!;

    if (user.collateral.available < margin) {
      throw new Error(`User does not have available margin`);
    }

    // current price would be valid price for limit, else for market order get the next best price,
    // depending on wheather it is a LONG or a SHORT
    let entryPrice =
      orderType === "limit"
        ? price
        : type === "LONG"
          ? getNextBestAskPrice(orderbook.asks)
          : getNextBestBidPrice(orderbook.bids);
    if (!entryPrice) {
      throw new Error(`There are no matches available`);
    }
    // verify if the margin given is within allowed range for the market
    const leverage = isRiskReducingOrder ? 0 : (entryPrice * qty) / margin;
    if (orderbook.allowedLeverage < leverage) {
      throw new Error(`Leverage not supported`);
    }

    if (!isRiskReducingOrder && margin > 0) {
      user.collateral.available -= margin;
      user.collateral.locked += margin;
    }

    const order = createOrder({
      market,
      type,
      qty,
      margin,
      price: entryPrice,
      orderType,
    });
    user.orders.push(order);

    return matchOrder(order, orderbook, user);
  };
  const cancelOrder = () => {
    // td:: if a risk reducing order was placed earlier, that'd not have the margin required for that as it was identified as risk reducing. but now if the user is cancelling the order that was supposed to be the earlier one with risk. so that should be considered. if that is being cancelled. waaaaiiiiiiiiit, the order isn't cancelled, the position is squared off. this endpoint is though specifically to cancel an order which is not yet position-ized, i.e. not yet matched and thus position is not yet created. so it should be straigt-forward
  };
  */

  //
  const handle = ({
    payload,
    type,
  }: Pick<TEngineRequestSchema, "payload" | "type">): Record<
    string,
    unknown
  > => {
    if (type === "init_balance") {
      const { userId } = payload as { userId: string };
      let balance = store.balances.get(userId);
      if (!balance) {
        balance = { available: 0, locked: 0 };
        store.balances.set(userId, balance);
      }

      return { userId, balance };
    } else if (type === "onramp") {
      const { userId, amount } = payload as { userId: string; amount: number };
      let balance = store.balances.get(userId);
      if (!balance) {
        balance = { available: amount, locked: 0 };
        store.balances.set(userId, balance);
      } else {
        balance.available += amount;
      }

      return { userId, available: balance.available };
    } else if (type === "create_order") {
      return payload;
    }
    return {
      v: "b",
      w: "d",
    };
  };
  return { handle };
}

export type TEngine = ReturnType<typeof createEngine>;
