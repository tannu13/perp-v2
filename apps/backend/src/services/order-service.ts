import type { TComms } from "./backend-comms";

export const createOrderService = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const onramp = async (userId: string, addBalance: number) => {
    return await sendToEngine("onramp", {
      userId,
      amount: addBalance,
    });
  };

  return { onramp };
};
