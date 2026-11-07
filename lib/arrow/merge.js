const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { BATCH_SIZE } = require("./schema");
const { TIME_PARTITION_SECONDS } = require("./partitioning");

function compare(a, b) {
  return (
    a.departureTime - b.departureTime ||
    a.tripIdx - b.tripIdx ||
    a.serviceDate - b.serviceDate ||
    a.stopSequence - b.stopSequence
  );
}
async function* lines(file) {
  const input = fs.createReadStream(file);
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) if (line) yield JSON.parse(line);
  } finally {
    reader.close();
    input.destroy();
  }
}
class Heap {
  constructor() {
    this.items = [];
  }
  push(item) {
    let i = this.items.length;
    this.items.push(item);
    while (i) {
      const p = (i - 1) >> 1;
      if (compare(this.items[p].row, item.row) <= 0) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          compare(this.items[child + 1].row, this.items[child].row) < 0
        )
          child++;
        if (compare(last.row, this.items[child].row) <= 0) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}
class PlanningSpool {
  constructor(directory, stops) {
    this.directory = directory;
    this.stops = stops;
    this.groups = new Map();
    this.pending = 0;
    this.total = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.firstDay = Infinity;
    this.lastDay = -Infinity;
    fs.mkdirSync(directory, { recursive: true });
  }
  async add(row) {
    const region = this.stops[row.departureStopIdx].regionIdx;
    const epoch =
      Math.floor(row.departureTime / TIME_PARTITION_SECONDS) *
      TIME_PARTITION_SECONDS;
    const key = `${region}-${epoch}`;
    if (!this.groups.has(key))
      this.groups.set(key, {
        region,
        epoch,
        file: path.join(this.directory, key + ".ndjson"),
        buffer: [],
      });
    this.groups.get(key).buffer.push(JSON.stringify(row) + "\n");
    this.pending++;
    this.total++;
    this.min = Math.min(this.min, row.departureTime);
    this.max = Math.max(this.max, row.departureTime);
    this.firstDay = Math.min(this.firstDay, row.serviceDate);
    this.lastDay = Math.max(this.lastDay, row.serviceDate);
    if (this.pending >= 5000) await this.flush();
  }
  async flush() {
    for (const group of this.groups.values())
      if (group.buffer.length) {
        await fs.promises.appendFile(group.file, group.buffer.join(""));
        group.buffer = [];
      }
    this.pending = 0;
  }
  async publish(publish) {
    await this.flush();
    const descriptors = [];
    for (const group of [...this.groups.values()].sort(
      (a, b) => a.epoch - b.epoch || a.region - b.region,
    )) {
      const runs = [];
      let rows = [];
      const save = async () => {
        if (runs.length >= 64)
          throw new Error(
            "Partition exceeds 64 external-sort runs; increase region partitioning",
          );
        rows.sort(compare);
        const file = group.file + ".run" + runs.length;
        await fs.promises.writeFile(
          file,
          rows.map((r) => JSON.stringify(r) + "\n").join(""),
        );
        runs.push(file);
        rows = [];
      };
      for await (const row of lines(group.file)) {
        rows.push(row);
        if (rows.length === BATCH_SIZE) await save();
      }
      if (rows.length) await save();
      const iterators = runs.map((file) => lines(file)[Symbol.asyncIterator]());
      const heap = new Heap();
      for (let i = 0; i < iterators.length; i++) {
        const next = await iterators[i].next();
        if (!next.done) heap.push({ row: next.value, index: i });
      }
      let page = [];
      let pageIndex = 0;
      let previous;
      const emit = async () => {
        const first = page[0].departureTime;
        const last = page.at(-1).departureTime;
        const arrivalRegions = [
          ...new Set(page.map((r) => this.stops[r.arrivalStopIdx].regionIdx)),
        ].sort((a, b) => a - b);
        const data = page.map((row) => {
          const departureTimeOffset = row.departureTime - group.epoch;
          const arrivalTimeOffset = row.arrivalTime - group.epoch;
          if (
            !Number.isSafeInteger(arrivalTimeOffset) ||
            arrivalTimeOffset < 0 ||
            arrivalTimeOffset > 0xffffffff ||
            departureTimeOffset < 0 ||
            departureTimeOffset >= TIME_PARTITION_SECONDS
          )
            throw new Error("Arrow time offset outside allowed range");
          const rest = { ...row };
          delete rest.departureTime;
          delete rest.arrivalTime;
          return { ...rest, departureTimeOffset, arrivalTimeOffset };
        });
        const period = new Date(group.epoch * 1000).toISOString().slice(0, 13);
        const descriptor = await publish(
          "planning",
          `planning/${group.region}/${period}/${String(pageIndex++).padStart(5, "0")}.arrow`,
          data,
          { epochSeconds: String(group.epoch) },
        );
        descriptors.push({
          ...descriptor,
          epochSeconds: group.epoch,
          regionId: group.region,
          minDepartureTime: first,
          maxDepartureTime: last,
          arrivalRegions,
        });
        page = [];
      };
      try {
        while (heap.items.length) {
          const item = heap.pop();
          if (previous && compare(previous, item.row) === 0)
            throw new Error("Duplicate connection key");
          previous = item.row;
          page.push(item.row);
          if (page.length === BATCH_SIZE) await emit();
          const next = await iterators[item.index].next();
          if (!next.done) heap.push({ row: next.value, index: item.index });
        }
        if (page.length) await emit();
      } finally {
        await Promise.all(iterators.map((iterator) => iterator.return()));
      }
      await Promise.all(
        [group.file, ...runs].map((file) => fs.promises.rm(file)),
      );
    }
    return descriptors;
  }
}
module.exports = { PlanningSpool };
