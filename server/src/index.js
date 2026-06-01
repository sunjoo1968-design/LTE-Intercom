import { createStore } from "./state.js";
import { createApp } from "./http.js";

const port = Number(process.env.PORT || 8443);
const host = process.env.HOST || "0.0.0.0";
const store = createStore();

const { server } = createApp({ store });

server.listen(port, host, () => {
  console.log(`LTE Intercom server listening on http://${host}:${port}`);
  console.log(`LTE Intercom server control UI http://localhost:${port}/admin`);
});
