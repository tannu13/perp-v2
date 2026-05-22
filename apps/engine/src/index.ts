import { createExchangeStore } from "./store";
import { createEngine } from "./services/exchange-engine";
import { setupComms } from "./services/engine-comms";

const store = createExchangeStore();
const engine = createEngine(store);

const comms = await setupComms({ engineHandler: engine.handle });

await comms.handlePendingEntries();

comms.listenToIncomingEvents();
