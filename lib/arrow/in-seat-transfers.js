const { uint } = require("./io");

// Calls arrive grouped by trip and service date. Retain only each run's two
// endpoints, rather than its stop times, while the connection pages are built.
class InSeatTransfers {
  constructor(dictionaries, options = {}) {
    this.dictionaries = dictionaries;
    this.summary = {
      enabled: options.deriveInSeatTransfers !== false,
      maxGapSeconds: uint(
        options.maxInSeatTransferGap,
        "maximum in-seat transfer gap",
        25 * 60,
      ),
      derivedLinks: 0,
      qualifyingPairDays: 0,
      skipped: {
        gapTooLarge: 0,
        differentStop: 0,
        timeOverlap: 0,
        explicitRulePresent: 0,
        missingEndpointTime: 0,
      },
    };
    this.blocks = new Map();
  }

  add(call) {
    if (!this.summary.enabled) return;
    const block = this.dictionaries.trips[call.tripIdx].blockId;
    if (!block) return;
    if (
      !this.current ||
      this.current.tripIdx !== call.tripIdx ||
      this.current.serviceDate !== call.serviceDate
    ) {
      let dates = this.blocks.get(block);
      if (!dates) this.blocks.set(block, (dates = new Map()));
      let runs = dates.get(call.serviceDate);
      if (!runs) dates.set(call.serviceDate, (runs = []));
      this.current = {
        tripIdx: call.tripIdx,
        serviceDate: call.serviceDate,
        firstStopIdx: call.stopIdx,
        departure: call.departureTime,
      };
      runs.push(this.current);
    }
    this.current.lastStopIdx = call.stopIdx;
    this.current.arrival = call.arrivalTime;
  }

  derive(transfers, strategy) {
    const { trips, stops } = this.dictionaries;
    const pairKey = (from, to) => JSON.stringify([from, to]);
    const explicit = new Set(
      transfers
        .filter((row) => row.transferType >= 4)
        .map((row) => pairKey(row.fromTripIdx, row.toTripIdx)),
    );
    const emitted = new Set();
    for (const dates of this.blocks.values()) {
      for (const runs of dates.values()) {
        runs.sort((a, b) => {
          // Runs without a first departure sort last and cannot be destinations.
          if (a.departure === null)
            return b.departure === null ? a.tripIdx - b.tripIdx : 1;
          if (b.departure === null) return -1;
          return a.departure < b.departure
            ? -1
            : a.departure > b.departure
              ? 1
              : a.tripIdx - b.tripIdx;
        });
        for (let i = 1; i < runs.length; i++) {
          const from = runs[i - 1];
          const to = runs[i];
          const pair = pairKey(from.tripIdx, to.tripIdx);
          let reason;
          if (explicit.has(pair)) reason = "explicitRulePresent";
          else if (from.lastStopIdx !== to.firstStopIdx)
            reason = "differentStop";
          else if (from.arrival === null || to.departure === null)
            reason = "missingEndpointTime";
          else if (to.departure < from.arrival) reason = "timeOverlap";
          else if (
            to.departure - from.arrival >
            BigInt(this.summary.maxGapSeconds)
          )
            reason = "gapTooLarge";
          if (reason) {
            this.summary.skipped[reason]++;
            continue;
          }
          this.summary.qualifyingPairDays++;
          if (emitted.has(pair)) continue;
          emitted.add(pair);
          const key = pairKey(
            trips[from.tripIdx].tripId,
            trips[to.tripIdx].tripId,
          );
          transfers.push({
            iri: strategy.mint(
              "entity",
              { entity: { kind: "transfers", key } },
              ["transfers", key],
            ),
            fromStopIdx: from.lastStopIdx,
            toStopIdx: to.firstStopIdx,
            fromStopIri: stops[from.lastStopIdx].iri,
            toStopIri: stops[to.firstStopIdx].iri,
            transferType: 4,
            minTransferTime: null,
            fromTripIdx: from.tripIdx,
            toTripIdx: to.tripIdx,
            fromTripIri: trips[from.tripIdx].iri,
            toTripIri: trips[to.tripIdx].iri,
          });
          this.summary.derivedLinks++;
        }
      }
    }
    return this.summary;
  }
}

module.exports = { InSeatTransfers };
