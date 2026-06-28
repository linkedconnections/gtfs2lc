const URIStrategy = require("./URIStrategy");

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function configurationFileName(agencyName, feedId) {
  const agencySlug = slugify(agencyName) || "agency";
  return `${agencySlug}-${feedId}.json`;
}

function recommendedBaseUris(namespace) {
  const base = namespace.endsWith("/") ? namespace : `${namespace}/`;
  return {
    stop: `${base}stops/{stops.stop_id}`,
    route: `${base}routes/{routes.route_id}`,
    trip: `${base}trips/{trips.trip_id}/{trips.startTime(yyyyMMdd)}`,
    connection: `${base}connections/{trips.startTime(yyyyMMdd)}/{trips.trip_id}/{stopSequence}`,
    resolve: {
      stopSequence: "connection.stop_sequence",
    },
  };
}

function previewBaseUris(baseUris) {
  const strategy = new URIStrategy(structuredClone(baseUris));
  const connection = {
    departureTime: new Date("2026-01-15T08:30:00Z"),
    arrivalTime: new Date("2026-01-15T08:45:00Z"),
    departureStop: { stop_id: "STOP-123" },
    arrivalStop: { stop_id: "STOP-456" },
    route: { route_id: "ROUTE-12" },
    trip: {
      trip_id: "TRIP-42",
      startTime: new Date("2026-01-15T08:30:00Z"),
    },
    stop_sequence: "7",
  };
  return {
    stop: strategy.getStopId(connection.departureStop),
    route: strategy.getRouteId(connection),
    trip: strategy.getTripId(connection),
    connection: strategy.getId(connection),
  };
}

function validateNamespace(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter an absolute HTTP(S) URL, for example https://data.example.org/transit/my-agency/",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(
      "The namespace must use an HTTP(S) URL; HTTPS is recommended",
    );
  }
  if (/[{}]/u.test(value)) {
    throw new Error("Enter a base namespace without URI-template placeholders");
  }
  if (url.search || url.hash) {
    throw new Error(
      "The namespace must not contain a query string or fragment",
    );
  }
  return value.endsWith("/") ? value : `${value}/`;
}

module.exports = {
  configurationFileName,
  previewBaseUris,
  recommendedBaseUris,
  slugify,
  validateNamespace,
};
