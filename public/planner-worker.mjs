import {
  tableFromIPC,
  RecordBatchReader,
} from "https://cdn.jsdelivr.net/npm/apache-arrow@21.2.0/+esm";
import { createPlanner } from "./planner-core.mjs";
import { createPlannerService } from "./planner-service.mjs";

import { LoaderPool } from "./planner-loader-pool.mjs";
let pool;
if (typeof Worker !== "undefined") {
  try {
    pool = new LoaderPool(
      () =>
        new Worker(new URL("./planner-loader-worker.mjs", import.meta.url), {
          type: "module",
        }),
      Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
    );
  } catch (error) {
    console.warn(
      "Loader workers unavailable; reading in the scan worker",
      error,
    );
  }
}
const handle = createPlannerService(
  createPlanner(
    { tableFromIPC, RecordBatchReader },
    { loadPage: pool ? (request) => pool.load(request) : undefined },
  ),
);
// Serialize requests so two scans cannot duplicate downloads or contend over
// the cache. Fetches within a scan still run concurrently.
let queue = Promise.resolve();
self.addEventListener("message", ({ data: { id, type, payload } }) => {
  queue = queue.then(async () => {
    try {
      const result = await handle(type, payload, (progress) => {
        self.postMessage({ id, type: "progress", progress });
      });
      self.postMessage({ id, type: "result", result });
    } catch (error) {
      self.postMessage({ id, type: "error", error: error.message });
    }
  });
});
