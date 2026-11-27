const arrow = require("apache-arrow");
const definitions = require("./definitions.json");
const BATCH_SIZE = 50000;
const SPECIFICATION = "https://linkedconnections.org/specification/2-0-alpha";
function schemaFor(name, metadata = {}) {
  if (!definitions[name]) throw new Error(`Unknown Arrow dataset: ${name}`);
  return new arrow.Schema(
    definitions[name].map(
      (f) => new arrow.Field(f.name, new arrow[f.type](), f.nullable),
    ),
    new Map(
      Object.entries({
        format: "linked-connections",
        schemaVersion: "2-alpha",
        identityProfile: "lc-global-v1",
        dataset: name,
        specification: SPECIFICATION,
        ...metadata,
      }).map(([k, v]) => [k, String(v)]),
    ),
  );
}
module.exports = {
  definitions,
  schemaFor,
  BATCH_SIZE,
  SPECIFICATION,
};
