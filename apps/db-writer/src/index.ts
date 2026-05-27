import { setupComms } from "./services/setup-comms";
import { createWriter } from "./services/writer";

const dbWriter = createWriter();
const comms = await setupComms({
  requestHandler: dbWriter.handleRequest,
  responseHandler: dbWriter.handleResponse,
});

await comms.handlePendingEntries();

comms.listenToIncomingEvents();
