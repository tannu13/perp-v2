import { createExchangeStore, type TStore } from "./store";
import { createEngine } from "./services/exchange-engine";
import { setupComms } from "./services/engine-comms";
import { createUploader } from "./services/upload-file";
import { isDev } from "./env";

const { uploadToS3, loadStoreFromS3 } = createUploader();

/**
 * `loadStoreFromS3` returns null when the bucket holds no snapshot — the normal
 * state of a cold stack, and of every fresh environment. Dereferencing it
 * unconditionally meant the engine could only ever start on a machine that had
 * already run it once, which is exactly backwards for a recovery mechanism.
 */
const dataBackup = (await loadStoreFromS3()) as {
  messageId: string;
  store: TStore;
} | null;

if (!dataBackup) {
  console.log("no snapshot to restore — starting from a fresh store");
}

const store = createExchangeStore(dataBackup?.store);

const engine = createEngine({ store, uploadToS3 });

const comms = await setupComms({ engineHandler: engine.handle });
if (dataBackup?.messageId && !isDev()) {
  // td:: maintain messageIds run through recovery and skip them in pending entries handler
  await comms.runRecovery(dataBackup.messageId);
}

await comms.handlePendingEntries();

comms.listenToIncomingEvents();
