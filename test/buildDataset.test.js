const {
  configurationFileName,
  previewBaseUris,
  recommendedBaseUris,
  slugify,
  validateNamespace,
} = require("../lib/DatasetConfiguration");

test("creates agency and Mobility Database keyed configuration filenames", () => {
  expect(slugify("De Lijn")).toBe("de-lijn");
  expect(configurationFileName("De Lijn", "mdb-684")).toBe(
    "de-lijn-mdb-684.json",
  );
});

test("recommended URI templates produce distinct, stable identifiers", () => {
  const baseUris = recommendedBaseUris(
    "https://data.example.test/transit/de-lijn/",
  );
  const preview = previewBaseUris(baseUris);

  expect(preview.stop).toBe(
    "https://data.example.test/transit/de-lijn/stops/STOP-123",
  );
  expect(preview.route).toContain("/routes/ROUTE-12");
  expect(preview.trip).toContain("/trips/TRIP-42/20260115");
  expect(preview.connection).toContain("/connections/20260115/TRIP-42/7");
  expect(new Set(Object.values(preview)).size).toBe(4);
});

test("validates and normalizes public namespaces", () => {
  expect(validateNamespace("https://data.example.test/transit")).toBe(
    "https://data.example.test/transit/",
  );
  expect(() => validateNamespace("urn:example:transit")).toThrow("HTTP(S)");
  expect(() => validateNamespace("https://example.test/{agency}")).toThrow(
    "without URI-template placeholders",
  );
});
