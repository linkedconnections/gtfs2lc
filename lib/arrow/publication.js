const uriTemplate = require("uri-templates");
const { absoluteIri } = require("./iri-strategy");

function legalMetadata(options) {
  const legal = {};
  if (options.license !== undefined)
    legal.license = absoluteIri(options.license);
  if (options.rights !== undefined) {
    if (typeof options.rights !== "string" || !options.rights.trim())
      throw new Error("rights must be a nonempty statement");
    legal.rights = options.rights.trim();
  }
  return legal;
}

function realtimeFeeds(feeds, dictionaries) {
  if (feeds === undefined) return undefined;
  if (!Array.isArray(feeds))
    throw new Error("realtime must be an array of feeds");
  return feeds.map((feed) => {
    if (!feed || feed["@type"] !== "GtfsRealtimeFeed")
      throw new Error("Expected a GtfsRealtimeFeed");
    const iri = absoluteIri(feed["@id"]);
    if (!["http:", "https:"].includes(new URL(iri).protocol))
      throw new Error("GTFS Realtime feed must have an HTTP(S) IRI");
    const result = {
      "@id": iri,
      "@type": "GtfsRealtimeFeed",
    };
    for (const [kind, variable, rows, raw] of [
      ["trip", "trip_id", dictionaries.trips, dictionaries.tripsRaw],
      ["stop", "stop_id", dictionaries.stops, dictionaries.stopsRaw],
      ["route", "route_id", dictionaries.routes, dictionaries.routesRaw],
    ]) {
      const key = `${kind}Template`;
      const template = feed[key];
      if (template === undefined && kind !== "trip") continue;
      if (typeof template !== "string" || !template.includes("{"))
        throw new Error(`GTFS Realtime ${key} is required`);
      const expansion = uriTemplate(template);
      rows.forEach((row, i) => {
        const minted = expansion.fill((name) => {
          if (name !== variable)
            throw new Error(`Unknown ${key} variable: ${name}`);
          return raw[i][variable];
        });
        if (minted !== row.iri)
          throw new Error(
            `GTFS Realtime ${key} does not reproduce ${kind} IRI: ${raw[i][variable]}`,
          );
      });
      result[key] = template;
    }
    return result;
  });
}

module.exports = { legalMetadata, realtimeFeeds };
