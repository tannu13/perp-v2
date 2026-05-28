import db, { and, eq } from "@repo/db";
import {
  fills,
  orders,
  processedEvents,
  type InsertFillRecord,
  type InsertOrderRecord,
  type TOrderStatusesEnum,
} from "@repo/db/schema";
import type {
  TEngineRequestSchema,
  TEngineResponseSchema,
  TOrderDataForWriterSchema,
} from "@repo/shared/redis-events";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const createWriter = () => {
  const handleRequest = async (data: TEngineRequestSchema) => {
    if (data.type === "create_order") {
      // writing it at backend itself as the order creation sometimes happen slower than fill are being written to db. so there's a foreign key contraint error when that happens
      // need to maybe create a separate stream for db writer
      // const newOrder = {
      //   ...(payload as InsertOrderRecord),
      //   createdAt: new Date(payload.createdAt as string),
      //   updatedAt: new Date(payload.updatedAt as string),
      // };
      // await db.insert(orders).values([newOrder]);
    }
  };

  const insertOrderData = async (tx: Tx, orderData: InsertOrderRecord[]) => {
    const maxBatchSize = 100;
    for (let i = 0; i < orderData.length; i += maxBatchSize) {
      const batch = orderData.slice(i, i + maxBatchSize);
      await tx.insert(orders).values(batch);
    }
  };
  const updateOrderData = async (
    tx: Tx,
    orderData: TOrderDataForWriterSchema[],
  ) => {
    // this'll be update entries.
    for (const orderEntry of orderData) {
      await tx
        .update(orders)
        .set({
          status: orderEntry.status as TOrderStatusesEnum,
          filledQty: `${orderEntry.filledQty}`,
        })
        .where(
          and(
            eq(orders.id, orderEntry.orderId),
            eq(orders.userId, orderEntry.userId),
          ),
        );
    }
  };

  const insertFillData = async (tx: Tx, fillData: InsertFillRecord[]) => {
    const maxBatchSize = 100;
    for (let i = 0; i < fillData.length; i += maxBatchSize) {
      const batch = fillData.slice(i, i + maxBatchSize);
      await tx.insert(fills).values(batch);
    }
  };

  const checkProcessedEvents = async (tx: Tx, correlationId: string) => {
    await tx.insert(processedEvents).values([
      {
        idempotencyKey: correlationId,
      },
    ]);
  };

  const handleResponse = async (payload: TEngineResponseSchema) => {
    if (!payload.data || !payload.data.writer) {
      return;
    }

    const { writer } = payload.data;
    const { correlationId } = payload;

    // write fills & orders
    // do them in order - order_inserts, order_updates, fills
    await db.transaction(async (tx) => {
      await checkProcessedEvents(tx, correlationId);

      const orderInserts = writer.find((e) => e.table === "order_inserts");
      if (orderInserts) {
        await insertOrderData(tx, orderInserts.data);
      }

      const orderUpdates = writer.find((e) => e.table === "order_updates");
      if (orderUpdates) {
        await updateOrderData(tx, orderUpdates.data);
      }

      const fillInserts = writer.find((e) => e.table === "fills");
      if (fillInserts) {
        await insertFillData(tx, fillInserts.data);
      }
    });
  };

  return { handleRequest, handleResponse };
};

export type TWriterHandle = ReturnType<typeof createWriter>;
