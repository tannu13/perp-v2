import { createExchangeStore, type TStore } from "./store";
import { createEngine } from "./services/exchange-engine";
import { setupComms } from "./services/engine-comms";
import { createUploader } from "./services/upload-file";
import { isDev } from "./env";

const { uploadToS3, loadStoreFromS3 } = createUploader();
const dataBackup = (await loadStoreFromS3()) as {
  messageId: string;
  store: TStore;
};
const store = createExchangeStore(dataBackup.store);

const engine = createEngine({ store, uploadToS3 });

const comms = await setupComms({ engineHandler: engine.handle });
if (dataBackup.messageId && !isDev()) {
  // td:: maintain messageIds run through recovery and skip them in pending entries handler
  await comms.runRecovery(dataBackup.messageId);
}

await comms.handlePendingEntries();

comms.listenToIncomingEvents();
