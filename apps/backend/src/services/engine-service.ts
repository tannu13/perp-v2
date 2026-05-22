import type { TComms } from "./backend-comms";

export const createEngineService = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const onramp = async (userId: string, addBalance: number) => {
    //
    console.log(userId, addBalance);
  };

  return { onramp };
};
