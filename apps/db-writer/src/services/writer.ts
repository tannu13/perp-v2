import db, { and, eq } from "@repo/db";
import {
  fills,
  orders,
  type InsertFillRecord,
  type InsertOrderRecord,
  type TOrderStatusesEnum,
} from "@repo/db/schema";
import type {
  TEngineRequestSchema,
  TEngineResponseSchema,
  TOrderDataForWriterSchema,
} from "@repo/shared/redis-events";

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

  const writeOrderData = async (orderData: TOrderDataForWriterSchema[]) => {
    // this'll be update entries.
    for (const orderEntry of orderData) {
      await db
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

  const writeFillData = async (fillData: InsertFillRecord[]) => {
    const maxBatchSize = 100;
    for (let i = 0; i < fillData.length; i += maxBatchSize) {
      const batch = fillData.slice(i, i + maxBatchSize);
      await db.insert(fills).values(batch);
    }
  };
  const handleResponse = async (payload: TEngineResponseSchema) => {
    if (!payload.data || !payload.data.writer) {
      return;
    }

    const { writer } = payload.data;

    // write fills & orders
    for (const entry of writer) {
      if (entry.table === "fills") {
        await writeFillData(entry.data);
      }
      if (entry.table === "orders") {
        await writeOrderData(entry.data);
      }
    }
  };

  return { handleRequest, handleResponse };
};

export type TWriterHandle = ReturnType<typeof createWriter>;
