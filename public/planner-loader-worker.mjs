import { RecordBatchReader } from "https://cdn.jsdelivr.net/npm/apache-arrow@21.2.0/+esm";
import { readConnectionBatches, buffersOf } from "./planner-data.mjs";

self.addEventListener("message", async ({ data }) => {
  try {
    const batches = await readConnectionBatches(RecordBatchReader, data);
    self.postMessage({ batches }, buffersOf(batches));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
