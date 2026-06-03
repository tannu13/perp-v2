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
  type TWriterSchema,
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

  const getUserById = (userId: string) => {
    return store.users.get(userId);
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
      filledQty: currentOrder.filledQty,
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
      filledQty: currentOrder.filledQty,
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

  const placeOrder = (payload: SelectOrderRecord) => {
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
    if (!initialMargin) {
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
      normalizedPayload.price = normalizedPayload.slippage;
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

    return matchOrder(normalizedPayload, orderbook, user);
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
  };
  const cancelOrder = (order: SelectOrderRecord): TCancelOrderReturnType => {
    // if a risk reducing order was placed earlier, that'd not have the margin required for that as it was identified as risk reducing. but now if the user is cancelling the order that was supposed to be the earlier one with risk. so that should be considered. if that is being cancelled. waaaaiiiiiiiiit, the order isn't cancelled, the position is squared off. this endpoint is though specifically to cancel an order which is not yet position-ized, i.e. not yet matched and thus position is not yet created. so it should be straigt-forward.
    // td::cancel only what is sitting on the order book and not the positions PLUS revert the apt balances

    let orderbookRecord: TBid | undefined;
    const orderbook = store.orderbooks[order.marketId];
    const user = getUserById(order.userId);
    if (!orderbook || !user) {
      throw new Error("Order not found");
    }
    if (order.positionType === "LONG") {
      // find the order in bids

      orderbookRecord = orderbook.bids[`${order.price}`];
    } else {
      // find the order in asks
      orderbookRecord = orderbook.asks[`${order.price}`];
    }

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

    // delete the order
    orderbookRecord.openOrders.splice(orderIndex, 1);
    const remainingQty = Number(order.qty) - Number(order.filledQty);
    orderbookRecord.availableQty -= remainingQty;
    if (
      orderbookRecord.availableQty <= 0 ||
      orderbookRecord.openOrders.length <= 0
    ) {
      delete orderbook.asks[`${order.price}`];
    }

    order.status = "cancelled";

    return {
      backend: {
        order,
        cancelledQty: openOrder.qty - openOrder.filledQty,
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
    };
  };

  const getOpenPositionsForMarket = (userId: string, marketId: string) => {
    const user = getUserById(userId);
    if (!user) {
      throw new Error("User has no positions");
    }

    const marketPositions = user.positions.filter(
      (pos) => pos.marketId === marketId,
    );

    return { positions: marketPositions };
  };

  const getClosedPositionsForMarket = (userId: string, marketId: string) => {
    const user = getUserById(userId);
    if (!user) {
      throw new Error("User has no positions");
    }

    const marketPositions = user.closedPositions.filter(
      (pos) => pos.marketId === marketId,
    );

    return { closedPositions: marketPositions };
  };

  const liqudationChecks = (asset: TSupportedAssets, price: number) => {
    const marketId = store.supportedAssets[asset];
    const allResponses: TMatchOrderFunctionResponse[] = [];

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

          const resp = placeOrder(newOrderData);
          if (!resp) continue;
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

          const resp = placeOrder(newOrderData);
          if (!resp) continue;
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

    return arrayToObjectUtil(allResponses);
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

      return { userId, balance: user.collateral.available };
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

      return { userId, available: user.collateral.available };
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
        balances: user.collateral,
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
      const { BTC, ETH, SOL } = payload as {
        SOL: string;
        ETH: string;
        BTC: string;
      };
      let resp: TMatchOrderFunctionResponse[] = [];
      if (BTC !== null) {
        resp.push(liqudationChecks("BTC", Number(BTC)));
      }
      if (ETH !== null) {
        resp.push(liqudationChecks("ETH", Number(ETH)));
      }
      if (SOL !== null) {
        resp.push(liqudationChecks("SOL", Number(SOL)));
      }

      return arrayToObjectUtil(resp);
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

      return getMarketDepth(marketId);
    }
    throw new Error("Unsupported request type");
  };
  return { handle };
}

export type TEngine = ReturnType<typeof createEngine>;
export type TEngineHandler = Parameters<TEngine["handle"]>[0];
