import { getSystemHealthStatus } from "@/src/services/system-status";

import { createHealthGetHandler } from "./handler";

export const GET = createHealthGetHandler({
  getSystemHealthStatus,
});
