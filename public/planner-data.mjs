export function timeAt(batch, field, row) {
  return batch.epoch + Number(batch[field][row]);
}

export function lowerBound(batch, time) {
  let lo = 0;
  let hi = batch.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timeAt(batch, "dep", mid) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Numeric toArray() on each single-batch vector gives a buffer view.
export async function readConnectionBatches(
  RecordBatchReader,
  { url, compressed, epochSeconds, from, to },
) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  const input = compressed
    ? new Response(response.body.pipeThrough(new DecompressionStream("gzip")))
    : response;
  const reader = await RecordBatchReader.from(input);
  const batches = [];
  for await (const batch of reader) {
    if (!batch.numRows) continue;
    const offsets = batch.getChild("departureTimeOffset");
    const metadataEpoch = batch.schema.metadata.get("epochSeconds");
    const epoch =
      epochSeconds ??
      (metadataEpoch === undefined ? undefined : Number(metadataEpoch));
    if (
      offsets &&
      (!Number.isSafeInteger(epoch) ||
        (metadataEpoch !== undefined && Number(metadataEpoch) !== epoch))
    )
      throw new Error(`Missing or inconsistent page epoch: ${url}`);
    const view = {
      epoch: offsets ? epoch : 0,
      dep: (offsets || batch.getChild("departureTime")).toArray(),
      arr: batch
        .getChild(offsets ? "arrivalTimeOffset" : "arrivalTime")
        .toArray(),
      dS: batch.getChild("departureStopIdx").toArray(),
      aS: batch.getChild("arrivalStopIdx").toArray(),
      trip: batch.getChild("tripIdx").toArray(),
      pickup: batch.getChild("pickupType")?.toArray(),
      dropOff: batch.getChild("dropOffType")?.toArray(),
      length: batch.numRows,
    };
    // Legacy monthly streams can discard past batches and stop after the window.
    if (timeAt(view, "dep", 0) >= to) break;
    if (timeAt(view, "dep", view.length - 1) >= from) batches.push(view);
  }
  return batches;
}

export function buffersOf(batches) {
  const buffers = new Set();
  for (const batch of batches)
    for (const value of Object.values(batch)) {
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    }
  return [...buffers];
}

export class PageCache {
  constructor(budget = 64 * 1024 * 1024) {
    this.budget = budget;
    this.bytes = 0;
    this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.batches;
  }
  set(key, batches) {
    const bytes = buffersOf(batches).reduce((sum, b) => sum + b.byteLength, 0);
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { batches, bytes });
    this.bytes += bytes;
  }
}

// One mutable cursor per batch. No combined row array or per-connection object.
export function scanBackward(batches, from, to, visit) {
  const heap = [];
  const greater = (a, b) =>
    a.time > b.time || (a.time === b.time && a.ordinal > b.ordinal);
  const push = (cursor) => {
    let i = heap.length;
    heap.push(cursor);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!greater(cursor, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = cursor;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && greater(heap[child + 1], heap[child]))
          child += 1;
        if (!greater(heap[child], last)) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  for (let ordinal = 0; ordinal < batches.length; ordinal += 1) {
    const batch = batches[ordinal];
    const lo = lowerBound(batch, from);
    const row = lowerBound(batch, to) - 1;
    if (row >= lo)
      push({ batch, row, lo, ordinal, time: timeAt(batch, "dep", row) });
  }
  let scanned = 0;
  while (heap.length) {
    // Equal-time connections can contain zero-duration chains. Retain only
    // numeric batch/row indices for this timestamp and relax to a fixed point.
    const time = heap[0].time;
    const group = [];
    while (heap.length && heap[0].time === time) {
      const cursor = pop();
      scanned += 1;
      if (timeAt(cursor.batch, "arr", cursor.row) === time)
        group.push(cursor.ordinal, cursor.row);
      else visit(cursor.batch, cursor.row, time);
      cursor.row -= 1;
      if (cursor.row >= cursor.lo) {
        cursor.time = timeAt(cursor.batch, "dep", cursor.row);
        push(cursor);
      }
    }
    let changed;
    do {
      changed = false;
      for (let i = 0; i < group.length; i += 2) {
        changed = visit(batches[group[i]], group[i + 1], time) || changed;
      }
    } while (changed);
  }
  return scanned;
}
