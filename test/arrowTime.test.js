const { duration, serviceEpoch } = require("../lib/arrow/time");

test.each([
  ["", null],
  [undefined, null],
  ["00:00:00", 0],
  ["08:12:34", 29554],
  ["25:10:00", 90600],
])("parses GTFS duration %p as %p seconds", (value, seconds) => {
  expect(duration(value)).toBe(seconds);
});

test.each(["-1:00:00", "08:60:00", "08:00:60", "8:00", "invalid"])(
  "rejects malformed GTFS duration %s",
  (value) => {
    expect(() => duration(value)).toThrow("Invalid GTFS time");
  },
);

test("rejects durations that lose integer precision", () => {
  expect(() => duration("99999999999999999:00:00")).toThrow(
    "GTFS duration overflows",
  );
});

test("service epochs distinguish timezones and normalize dates before caching", () => {
  expect(serviceEpoch("2026-10-25", "Europe/Brussels")).toBe(
    Date.parse("2026-10-24T23:00:00Z") / 1000,
  );
  expect(serviceEpoch("20261025", "Europe/Brussels")).toBe(
    serviceEpoch("2026-10-25", "Europe/Brussels"),
  );
  expect(serviceEpoch("20261025", "UTC")).toBe(
    Date.parse("2026-10-25T00:00:00Z") / 1000,
  );
});
