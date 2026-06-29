#!/usr/bin/env node

const fs = require("node:fs");
const {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createInterface } = require("node:readline/promises");
const { Command, InvalidArgumentError } = require("commander");
const unzipper = require("unzipper");
const {
  configurationFileName,
  previewBaseUris,
  recommendedBaseUris,
  slugify,
  validateNamespace,
} = require("../lib/DatasetConfiguration");
const packageJson = require("../package.json");

const apiBaseUrl =
  process.env.MOBILITYDATABASE_API_URL || "https://api.mobilitydatabase.org";
const root = path.resolve(__dirname, "..");

const program = new Command();
program
  .name("gtfs2lc-build")
  .description(
    "Discover, configure, and build a GTFS dataset from Mobility Database",
  )
  .version(packageJson.version)
  .argument("[query]", "agency name, location, or Mobility Database feed ID")
  .option(
    "--config-dir <path>",
    "directory containing saved feed configurations",
    ".",
  )
  .option("--output <path>", "output directory")
  .option("--format <format>", "gtfs2lc output format", "json")
  .option("--compressed", "gzip the generated dataset")
  .option("--workers <count>", "number of conversion workers", positiveInteger)
  .showHelpAfterError()
  .action(run);

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

async function ask(question, defaultValue) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`;
    const answer = (await readline.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    readline.close();
  }
}

async function confirm(question, defaultValue = true) {
  const answer = (
    await ask(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"}`)
  ).toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function choose(question, choices) {
  console.error(`\n${question}`);
  choices.forEach((choice, index) =>
    console.error(`  ${index + 1}. ${choice.label}`),
  );
  while (true) {
    const value = await ask("Choose a number");
    const index = Number.parseInt(value, 10) - 1;
    if (index >= 0 && index < choices.length) return choices[index].value;
    console.error(`Enter a number between 1 and ${choices.length}.`);
  }
}

async function askHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Set MOBILITYDATABASE_REFRESH_TOKEN when running without an interactive terminal.",
    );
  }
  process.stdout.write(`${question}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const restore = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (input) => {
      for (const character of input) {
        if (character === "\r" || character === "\n") {
          restore();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          restore();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error || parsed.detail || body;
    } catch {
      // Keep the response text as diagnostic context.
    }
    throw new Error(
      `Mobility Database API returned HTTP ${response.status}: ${detail}`,
    );
  }
  return body ? JSON.parse(body) : null;
}

async function getAccessToken() {
  if (process.env.MOBILITYDATABASE_ACCESS_TOKEN) {
    return process.env.MOBILITYDATABASE_ACCESS_TOKEN;
  }

  let refreshToken = process.env.MOBILITYDATABASE_REFRESH_TOKEN;
  if (!refreshToken) {
    console.error(
      "\nMobility Database requires an API refresh token. Create one through your Mobility Database account; it will only be used to obtain a one-hour access token and will not be saved.",
    );
    refreshToken = await askHidden(
      "Mobility Database refresh token (input hidden)",
    );
  }
  if (!refreshToken)
    throw new Error("A Mobility Database refresh token is required");

  const token = await requestJson(`${apiBaseUrl}/v1/tokens/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!token?.access_token)
    throw new Error("Mobility Database did not return an access token");
  return token.access_token;
}

async function apiGet(pathname, accessToken) {
  return requestJson(`${apiBaseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

function locationLabel(locations = []) {
  return locations
    .map((location) =>
      [location.municipality, location.subdivision_name, location.country_code]
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean)
    .join("; ");
}

function feedLabel(feed) {
  const name = feed.provider || feed.feed_name || "Unnamed provider";
  const details = [
    feed.id,
    feed.feed_name,
    locationLabel(feed.locations),
    feed.status,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${name} — ${details}${feed.official ? " · official" : ""}`;
}

async function discoverFeed(query) {
  const accessToken = await getAccessToken();
  if (/^mdb-\d+$/u.test(query)) {
    const feed = await apiGet(
      `/v1/gtfs_feeds/${encodeURIComponent(query)}`,
      accessToken,
    );
    if (feed.data_type !== "gtfs")
      throw new Error(`${query} is not a GTFS Schedule feed`);
    return feed;
  }

  const parameters = new URLSearchParams({
    search_query: query,
    data_type: "gtfs",
    limit: "25",
  });
  const response = await apiGet(`/v1/search?${parameters}`, accessToken);
  const results = (response.results || []).filter(
    (feed) => feed.data_type === "gtfs",
  );
  if (results.length === 0) throw new Error(`No GTFS feeds matched “${query}”`);
  return choose(
    `${response.total || results.length} Mobility Database result(s) matched. Select the intended feed:`,
    results.map((feed) => ({ label: feedLabel(feed), value: feed })),
  );
}

async function readConfigurations(directory) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const configurations = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/-mdb-\d+\.json$/u.test(entry.name)) continue;
    const fileName = path.join(directory, entry.name);
    try {
      const configuration = JSON.parse(await readFile(fileName, "utf8"));
      if (
        configuration._meta?.mobilityDatabaseId &&
        configuration._meta?.feedUrl
      ) {
        configurations.push({ configuration, fileName });
      }
    } catch (error) {
      console.error(
        `Ignoring invalid configuration ${fileName}: ${error.message}`,
      );
    }
  }
  return configurations;
}

function matchConfiguration(configurations, query) {
  if (!query) return undefined;
  const normalized = query.toLowerCase();
  const matches = configurations.filter(({ configuration, fileName }) => {
    const meta = configuration._meta;
    return (
      meta.mobilityDatabaseId.toLowerCase() === normalized ||
      meta.agencyName.toLowerCase() === normalized ||
      slugify(meta.agencyName) === slugify(query) ||
      path.basename(fileName, ".json") === normalized
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

async function chooseConfiguration(configurations) {
  if (configurations.length === 0) return undefined;
  return choose("Use a configured dataset or discover another one:", [
    ...configurations.map((item) => ({
      label: `${item.configuration._meta.agencyName} (${item.configuration._meta.mobilityDatabaseId})`,
      value: item,
    })),
    { label: "Discover another dataset", value: undefined },
  ]);
}

function validateTemplateSet(baseUris) {
  for (const [name, value] of Object.entries(baseUris)) {
    if (name === "resolve") continue;
    if (!/^https?:\/\//u.test(value))
      throw new Error(`${name} must be an absolute HTTP(S) URI template`);
  }
  return previewBaseUris(baseUris);
}

async function configureBaseUris(agencyName) {
  console.error(
    "\nLinked Connections need stable, globally unique identifiers. Use an HTTPS namespace on a domain you control. Keep it agency-specific so local GTFS identifiers cannot collide with another publisher.",
  );
  let namespace;
  while (!namespace) {
    try {
      namespace = validateNamespace(
        await ask(
          `Public base namespace for ${agencyName} (example: https://data.example.org/transit/${slugify(agencyName)}/)`,
        ),
      );
      if (namespace.includes("example.org")) {
        console.error(
          "example.org is documentation-only; use a domain that you control.",
        );
        namespace = undefined;
      }
    } catch (error) {
      console.error(error.message);
    }
  }

  let baseUris = recommendedBaseUris(namespace);
  console.error(
    "\nRecommended templates scope stops and routes to the agency, add the service date to trips, and add stop_sequence to Connections so loop routes remain unique:",
  );
  for (const [name, value] of Object.entries(baseUris)) {
    if (name !== "resolve") console.error(`  ${name}: ${value}`);
  }

  if (!(await confirm("Use these recommended URI templates?"))) {
    baseUris = {
      stop: await ask("Stop URI template", baseUris.stop),
      route: await ask("Route URI template", baseUris.route),
      trip: await ask("Trip URI template", baseUris.trip),
      connection: await ask("Connection URI template", baseUris.connection),
      resolve: baseUris.resolve,
    };
  }

  while (true) {
    try {
      const preview = validateTemplateSet(baseUris);
      console.error("\nIdentifier preview using representative GTFS values:");
      Object.entries(preview).forEach(([name, value]) =>
        console.error(`  ${name}: ${value}`),
      );
      if (await confirm("Do these identifiers look stable and correct?"))
        return baseUris;
    } catch (error) {
      console.error(`Invalid URI templates: ${error.message}`);
    }
    baseUris = {
      stop: await ask("Stop URI template", baseUris.stop),
      route: await ask("Route URI template", baseUris.route),
      trip: await ask("Trip URI template", baseUris.trip),
      connection: await ask("Connection URI template", baseUris.connection),
      resolve: baseUris.resolve,
    };
  }
}

async function selectFeedUrl(feed) {
  const producerUrl = feed.source_info?.producer_url;
  const hostedUrl = feed.latest_dataset?.hosted_url;
  const authenticationType = feed.source_info?.authentication_type || 0;
  const choices = [];
  if (producerUrl && authenticationType === 0) {
    choices.push({
      label: `Publisher URL (recommended, stays current): ${producerUrl}`,
      value: producerUrl,
    });
  }
  if (hostedUrl) {
    choices.push({
      label: `Mobility Database snapshot: ${hostedUrl}`,
      value: hostedUrl,
    });
  }
  if (producerUrl && authenticationType !== 0) {
    console.error(
      `The publisher URL requires authentication type ${authenticationType}; see ${feed.source_info.authentication_info_url || "the publisher documentation"}. The unauthenticated Mobility Database snapshot is recommended for this command.`,
    );
  }
  choices.push({ label: "Enter another GTFS ZIP URL", value: "custom" });
  const selected =
    choices.length === 2 && choices[0].value !== "custom"
      ? choices[0].value
      : await choose("Choose the GTFS ZIP source:", choices);
  return selected === "custom" ? ask("GTFS ZIP URL") : selected;
}

async function createConfiguration(feed, configDirectory) {
  const agencyName = feed.provider || feed.feed_name || feed.id;
  console.error(`\nSelected ${feedLabel(feed)}`);
  const feedUrl = await selectFeedUrl(feed);
  try {
    new URL(feedUrl);
  } catch {
    throw new Error(`Invalid GTFS feed URL: ${feedUrl}`);
  }
  const baseUris = await configureBaseUris(agencyName);
  const fileName = path.join(
    configDirectory,
    configurationFileName(agencyName, feed.id),
  );
  const configuration = {
    ...baseUris,
    _meta: {
      agencyName,
      mobilityDatabaseId: feed.id,
      feedUrl,
      publisherUrl: feed.source_info?.producer_url || null,
      mobilityDatabaseHostedUrl: feed.latest_dataset?.hosted_url || null,
      configuredAt: new Date().toISOString(),
    },
  };
  await writeFile(fileName, `${JSON.stringify(configuration, null, 2)}\n`, {
    mode: 0o600,
  });
  console.error(`\nSaved feed and URI configuration to ${fileName}`);
  return { configuration, fileName };
}

async function fileExists(fileName) {
  try {
    await access(fileName);
    return true;
  } catch {
    return false;
  }
}

async function findFeedDirectory(directory) {
  if (await fileExists(path.join(directory, "stop_times.txt")))
    return directory;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (await fileExists(path.join(candidate, "stop_times.txt")))
      return candidate;
  }
  throw new Error("The downloaded ZIP does not contain stop_times.txt");
}

async function downloadFeed(url, destination) {
  console.error(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`GTFS download failed with HTTP ${response.status}`);
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination),
  );
}

async function executeBuilder(configurationItem, options) {
  const { configuration, fileName } = configurationItem;
  const meta = configuration._meta;
  const buildName = `${slugify(meta.agencyName)}-${meta.mobilityDatabaseId}`;
  const outputDirectory = path.resolve(
    options.output || path.join("build", buildName),
  );
  const workspace = await mkdtemp(path.join(tmpdir(), "gtfs2lc-build-"));
  const zipFile = path.join(workspace, "feed.zip");
  const extracted = path.join(workspace, "feed");
  await mkdir(extracted, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  try {
    await downloadFeed(meta.feedUrl, zipFile);
    console.error("Extracting GTFS feed");
    await pipeline(
      fs.createReadStream(zipFile),
      unzipper.Extract({ path: extracted }),
    );
    const feedDirectory = await findFeedDirectory(extracted);
    const arguments_ = [
      path.join(root, "bin", "gtfs2lc.js"),
      "--fresh",
      "--format",
      options.format,
      "--base-uris",
      fileName,
      "--output",
      outputDirectory,
    ];
    if (options.compressed) arguments_.push("--compressed");
    if (options.workers) arguments_.push("--workers", String(options.workers));
    arguments_.push(feedDirectory);

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, arguments_, {
        cwd: root,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `gtfs2lc exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
            ),
          );
      });
    });
    console.error(`\nDataset created in ${outputDirectory}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function run(queryArgument, options) {
  const configDirectory = path.resolve(options.configDir);
  const configurations = await readConfigurations(configDirectory);
  let selected = matchConfiguration(configurations, queryArgument);

  if (!selected && !queryArgument)
    selected = await chooseConfiguration(configurations);
  if (!selected) {
    const query =
      queryArgument ||
      (await ask(
        "Search Mobility Database by agency, city, country, or mdb-ID",
      ));
    if (!query) throw new Error("A search query or feed ID is required");
    selected = await createConfiguration(
      await discoverFeed(query),
      configDirectory,
    );
  } else {
    console.error(
      `Using ${selected.fileName} for ${selected.configuration._meta.agencyName} (${selected.configuration._meta.mobilityDatabaseId})`,
    );
  }

  await executeBuilder(selected, options);
}

if (require.main === module) {
  program.parseAsync().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
