import { createPoller } from "./services/createPoller";
import { setupComms } from "./services/setupComms";

const comms = await setupComms();
const poller = createPoller(comms.sendToResponseStream);
poller.connect();
