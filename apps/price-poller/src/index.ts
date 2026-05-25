import { createPoller } from "./services/createPoller";
import { setupComms } from "./services/setupComms";

const comms = await setupComms();
createPoller(comms.sendToResponseStream);
