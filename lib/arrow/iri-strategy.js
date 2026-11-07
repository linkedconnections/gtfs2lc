"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.IriRegistry = exports.defaultIriConfiguration = void 0;
exports.absoluteIri = absoluteIri;
exports.iriSegment = iriSegment;
exports.serviceDate = serviceDate;
exports.createIriStrategy = createIriStrategy;
const identity_defaults_json_1 = __importDefault(
  require("./identity-defaults.json"),
);
exports.defaultIriConfiguration = identity_defaults_json_1.default;
function absoluteIri(value) {
  if (!value || /[\s<>"{}|^`\\]/u.test(value))
    throw new Error("Invalid absolute IRI");
  new URL(value);
  return value;
}
function baseIri(value) {
  absoluteIri(value);
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid identity base");
  return url.href.replace(/\/+$/, "");
}
function iriSegment(value) {
  if (
    !["string", "number", "boolean"].includes(typeof value) ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new Error("IRI placeholder must be a scalar");
  const key = String(value);
  if (!key || key === "." || key === "..")
    throw new Error("Identifier key must be non-empty and not a dot segment");
  return encodeURIComponent(key).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
function serviceDate(value) {
  if (!/^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(String(value)))
    throw new Error("Invalid service date");
  const day = String(value).replace(/-/g, "");
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  if (
    !/^\d{8}$/.test(day) ||
    Number.isNaN(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw new Error("Invalid service date");
  return day;
}
// Keep one registry for all sources/tables in a build. Persist its logical-key mappings
// across releases in a production publisher to detect upstream key reuse as well.
class IriRegistry {
  byIri = new Map();
  byKey = new Map();
  claim(iri, logicalKey) {
    if (this.byIri.has(iri) && this.byIri.get(iri) !== logicalKey)
      throw new Error(`IRI collision: ${iri}`);
    if (this.byKey.has(logicalKey) && this.byKey.get(logicalKey) !== iri)
      throw new Error(`Identifier changed for logical key: ${logicalKey}`);
    this.byIri.set(iri, logicalKey);
    this.byKey.set(logicalKey, iri);
    return iri;
  }
}
exports.IriRegistry = IriRegistry;
class MissingValue extends Error {}
const pathPattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
function pathParts(path) {
  if (
    !pathPattern.test(path) ||
    path
      .split(".")
      .some((p) => ["__proto__", "constructor", "prototype"].includes(p))
  )
    throw new Error(`Invalid resolver path: ${path}`);
  return path.split(".");
}
function dateParts(value, timeZone) {
  if (
    typeof value === "number" ||
    (typeof value === "string" && /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(value))
  ) {
    const day = serviceDate(value);
    return {
      yyyy: day.slice(0, 4),
      yy: day.slice(2, 4),
      MM: day.slice(4, 6),
      dd: day.slice(6, 8),
      HH: "00",
      mm: "00",
      ss: "00",
    };
  }
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value))
  )
    throw new Error(
      "Date resolver requires a service date or an instant with timezone",
    );
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime()))
    throw new Error("Invalid date resolver instant");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (key) => parts.find((p) => p.type === key).value;
  return {
    yyyy: get("year"),
    yy: get("year").slice(-2),
    MM: get("month"),
    dd: get("day"),
    HH: get("hour"),
    mm: get("minute"),
    ss: get("second"),
  };
}
function formatDate(value, pattern, timeZone) {
  const parts = dateParts(value, timeZone);
  let result = "";
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === "'") {
      if (pattern[i + 1] === "'") {
        result += "'";
        i += 2;
        continue;
      }
      const end = pattern.indexOf("'", i + 1);
      if (end < 0) throw new Error("Unterminated date format literal");
      result += pattern.slice(i + 1, end);
      i = end + 1;
    } else {
      const token = Object.keys(parts).find((key) =>
        pattern.startsWith(key, i),
      );
      if (token) {
        result += parts[token];
        i += token.length;
      } else if (/[A-Za-z]/.test(pattern[i]))
        throw new Error(`Unsupported date format token: ${pattern.slice(i)}`);
      else {
        result += pattern[i];
        i++;
      }
    }
  }
  return result;
}
function createIriStrategy(
  sourceId,
  configuration = exports.defaultIriConfiguration,
  registry = new IriRegistry(),
) {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(sourceId))
    throw new Error("Invalid registered source ID");
  if (configuration.strategyVersion !== 1 || !configuration.identityProfile)
    throw new Error("Unsupported IRI strategy configuration");
  const source = Object.hasOwn(configuration.sources, sourceId)
    ? configuration.sources[sourceId]
    : {};
  const rules = {
    strategyVersion: 1,
    identityProfile: configuration.identityProfile,
    sourceId,
    identityBase: baseIri(
      source.identityBase ??
        configuration.identityBase ??
        "https://irail.be/id",
    ),
    timeZone: source.timeZone ?? configuration.timeZone ?? "UTC",
    bases: { ...configuration.bases, ...source.bases },
    templates: { ...configuration.templates, ...source.templates },
    resolve: { ...configuration.resolve, ...source.resolve },
  };
  new Intl.DateTimeFormat("en-GB", { timeZone: rules.timeZone }); // Fail before publishing for an unknown zone.
  for (const [name, value] of Object.entries(rules.bases)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
      throw new Error("Invalid named IRI base");
    rules.bases[name] = baseIri(value);
  }
  for (const name of Object.keys(rules.resolve)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
      [
        "base",
        "bases",
        "sourceId",
        "stops",
        "routes",
        "trips",
        "connection",
        "provider",
        "agency",
        "shapes",
        "unit",
        "entity",
        "constructor",
        "prototype",
      ].includes(name)
    )
      throw new Error(`Reserved resolver name: ${name}`);
  }
  for (const template of Object.values(rules.templates)) {
    if (
      typeof template !== "string" ||
      !/^(?:\{base\}|\{bases\.[A-Za-z][A-Za-z0-9_]*\}|https?:\/\/[^/{}?#]+)\//.test(
        template,
      )
    )
      throw new Error(
        "IRI template must begin with an HTTP(S) authority or a configured base followed by /",
      );
    for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
      pathParts(match[1]);
      if (
        (match[1] === "base" || match[1].startsWith("bases.")) &&
        match.index !== 0
      )
        throw new Error(
          "IRI bases are allowed only at the start of a template",
        );
    }
    if (/[{}]/.test(template.replace(/\{[^{}]+\}/g, "")))
      throw new Error("Unbalanced IRI template");
  }
  function mint(kind, context, identityKey) {
    const template = Object.hasOwn(rules.templates, kind)
      ? rules.templates[kind]
      : undefined;
    if (!template) throw new Error(`No IRI template for entity kind: ${kind}`);
    if (!identityKey.length)
      throw new Error("A stable logical identity key is required");
    identityKey.forEach(iriSegment);
    const active = new Set();
    const cache = new Map();
    const read = (path) => {
      const [first, ...rest] = pathParts(path);
      let current;
      if (first && Object.hasOwn(rules.resolve, first)) {
        if (active.has(first)) throw new Error(`Cyclic IRI resolver: ${first}`);
        if (!cache.has(first)) {
          active.add(first);
          try {
            cache.set(first, evaluate(rules.resolve[first]));
          } finally {
            active.delete(first);
          }
        }
        current = cache.get(first);
      } else {
        if (!first || !Object.hasOwn(context, first))
          throw new MissingValue(`Missing IRI field: ${path}`);
        current = context[first];
      }
      for (const part of rest) {
        if (
          current === null ||
          typeof current !== "object" ||
          !Object.hasOwn(current, part)
        )
          throw new MissingValue(`Missing IRI field: ${path}`);
        current = current[part];
      }
      if (current === undefined || current === null)
        throw new MissingValue(`Missing IRI field: ${path}`);
      return current;
    };
    const scalar = (value) => {
      iriSegment(value);
      return String(value);
    };
    const evaluate = (resolver) => {
      if (typeof resolver === "string") {
        const expression = resolver.trim().replace(/;$/, "").trim();
        const format =
          /^format\(\s*([\w.]+)\s*,\s*'((?:\\'|[^'])*)'\s*\)$/.exec(expression);
        if (format)
          return formatDate(
            read(format[1]),
            format[2].replace(/\\'/g, "'"),
            rules.timeZone,
          );
        const substring =
          /^([\w.]+)\.substring\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(
            expression,
          );
        if (substring)
          return scalar(read(substring[1])).substring(
            Number(substring[2]),
            substring[3] === undefined ? undefined : Number(substring[3]),
          );
        return read(expression);
      }
      if (
        !resolver ||
        typeof resolver !== "object" ||
        Object.keys(resolver).length !== 1
      )
        throw new Error("Invalid IRI resolver");
      if ("literal" in resolver) return resolver.literal;
      if ("coalesce" in resolver) {
        for (const candidate of resolver.coalesce) {
          try {
            const value = evaluate(candidate);
            if (value !== "" && value !== null && value !== undefined)
              return value;
          } catch (error) {
            if (!(error instanceof MissingValue)) throw error;
          }
        }
        throw new MissingValue("No IRI resolver fallback has a value");
      }
      if ("concat" in resolver)
        return resolver.concat.map((item) => scalar(evaluate(item))).join("");
      if ("padStart" in resolver) {
        const { value, length, fill = "0" } = resolver.padStart;
        if (!Number.isInteger(length) || length < 1 || length > 256 || !fill)
          throw new Error("Invalid IRI padding");
        return scalar(evaluate(value)).padStart(length, fill);
      }
      throw new Error("Unknown IRI resolver operation");
    };
    const iri = absoluteIri(
      template.replace(/\{([^{}]+)\}/g, (_, path) => {
        if (path === "base") return rules.identityBase;
        if (path === "sourceId") return sourceId;
        if (path.startsWith("bases.")) {
          const name = path.slice(6);
          const value = Object.hasOwn(rules.bases, name)
            ? rules.bases[name]
            : undefined;
          if (!value) throw new Error(`Unknown IRI base: ${path}`);
          return value;
        }
        return iriSegment(read(path));
      }),
    );
    const url = new URL(iri);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== iri
    )
      throw new Error(
        "IRI template must produce a normalized HTTP(S) path without query, fragment or credentials",
      );
    return registry.claim(
      iri,
      JSON.stringify([sourceId, kind, identityKey.map(String)]),
    );
  }
  // A detached snapshot can be pinned with the release; mutating it cannot change the strategy.
  const snapshot = structuredClone(rules);
  return { mint, snapshot };
}
