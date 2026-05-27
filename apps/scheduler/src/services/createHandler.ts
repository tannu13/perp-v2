import type { TSendToEngineStream } from "./setupComms";

export const createHandler = (sendToEngineStream: TSendToEngineStream) => {
  const backupTrigger = async () => {
    await sendToEngineStream("backup_store");
  };
  const fundingRateDispersal = async () => {
    await sendToEngineStream("funding_rate_dispersal");
  };

  return { backupTrigger, fundingRateDispersal };
};
export type THandlerType = ReturnType<typeof createHandler>;
