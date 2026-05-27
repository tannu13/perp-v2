import { createExchangeStore } from "./store";
import { createEngine } from "./services/exchange-engine";
import { setupComms } from "./services/engine-comms";
import { createUploader } from "./services/upload-file";

const store = createExchangeStore();
const { uploadToS3 } = createUploader();
const engine = createEngine({ store, uploadToS3 });

const comms = await setupComms({ engineHandler: engine.handle });

await comms.handlePendingEntries();

comms.listenToIncomingEvents();
