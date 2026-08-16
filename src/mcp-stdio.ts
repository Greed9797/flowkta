import { serveMcpStdio } from "@invokta/mcp";

import { engine } from "./engine.js";

await serveMcpStdio(engine, { principal: null });
