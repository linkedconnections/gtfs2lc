const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  constrainCalendar,
  parseArguments,
  parseDate,
} = require("../scripts/build-sncb");

let directory;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "gtfs2lc-sncb-test-"));
  await writeFile(
    path.join(directory, "calendar.txt"),
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nold,1,1,1,1,1,1,1,20240101,20240131\nactive,1,1,1,1,1,1,1,20240101,20241231\n",
  );
  await writeFile(
    path.join(directory, "calendar_dates.txt"),
    "service_id,date,exception_type\nactive,20240204,1\nactive,20240205,2\nactive,20240212,1\n",
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("limits SNCB service calendars to the requested inclusive range", async () => {
  await constrainCalendar(
    directory,
    parseDate("2024-02-05"),
    parseDate("2024-02-11"),
  );

  const calendar = await readFile(path.join(directory, "calendar.txt"), "utf8");
  const exceptions = await readFile(
    path.join(directory, "calendar_dates.txt"),
    "utf8",
  );
  expect(calendar).not.toContain("old");
  expect(calendar).toContain("20240205,20240211");
  expect(exceptions).toContain("20240205");
  expect(exceptions).not.toContain("20240204");
  expect(exceptions).not.toContain("20240212");
});

test("rejects invalid start dates", () => {
  expect(() => parseDate("2024-02-30")).toThrow("Invalid date");
});

test("uses the requested SNCB output format", () => {
  expect(
    parseArguments(["--format", "turtle"], { SNCB_FORMAT: "json" }),
  ).toMatchObject({ format: "turtle" });
});
