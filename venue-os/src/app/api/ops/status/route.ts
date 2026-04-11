import {
  authorizeOpsStatusRequest,
  getOpsStatus,
  getSystemHealthStatus,
} from "@/src/services/system-status";

import { createOpsStatusGetHandler } from "./handler";

export const GET = createOpsStatusGetHandler({
  authorizeOpsStatusRequest,
  getOpsStatus,
  getSystemHealthStatus,
});
