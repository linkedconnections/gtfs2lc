const { serviceDate } = require("./iri-strategy");
const formatters = new Map();
const epochs = new Map();

function serviceEpoch(date, timeZone) {
  const day = serviceDate(date);
  const key = `${timeZone}/${day}`;
  if (epochs.has(key)) return epochs.get(key);
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const noon = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    12,
  );
  let instant = noon;
  for (let iteration = 0; iteration < 3; iteration++) {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const civil = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    const correction = noon - civil;
    instant += correction;
    if (!correction) break;
  }
  const epoch = instant / 1000 - 43200;
  epochs.set(key, epoch);
  return epoch;
}

function duration(value) {
  if (value === "" || value === undefined) return null;
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  const seconds = +match[1] * 3600 + +match[2] * 60 + +match[3];
  if (!Number.isSafeInteger(seconds))
    throw new Error("GTFS duration overflows");
  return seconds;
}
module.exports = { serviceEpoch, duration };
