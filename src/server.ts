import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AnalysisApi, AnalysisApiError } from "./api.js";

export const SERVER_NAME = "legendsviewer";
export const SERVER_VERSION = "0.1.0";

/**
 * Tool arguments are declared strict so a misspelled parameter is rejected instead of dropped.
 * Zod strips unknown keys by default, which means a caller asking for "maxNotableEvents" silently
 * gets the server default and no hint that the name was wrong.
 */
const args = z.strictObject;

/** Filters shared by the dossier, digest and event search routes. */
const eventFilters = {
  fromYear: z.number().int().optional().describe("Earliest year, inclusive."),
  toYear: z.number().int().optional().describe("Latest year, inclusive."),
  eventTypes: z
    .string()
    .optional()
    .describe(
      "Comma separated raw event type names, exactly as printed in brackets on each event line " +
        '(for example "hf died,created site"). Narrowing here also makes event search far faster.',
    ),
};

interface Bookmark {
  worldName?: string;
  worldRegionName?: string;
  filePath?: string;
  latestTimestamp?: string;
}

interface TypeCount {
  type: string;
  count: number;
}

export function createServer(api: AnalysisApi = new AnalysisApi()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
  const json = (value: unknown) => text(JSON.stringify(value, null, 2));

  server.registerTool(
    "world_status",
    {
      title: "World status",
      description:
        "Whether LegendsViewer is reachable, whether it exposes the analysis layer, and which world is loaded. " +
        "Also lists the object type names accepted by the other tools. Start here when anything fails.",
      inputSchema: {},
    },
    async () => {
      try {
        const types = await api.getJson<TypeCount[]>("/api/Analysis/types");
        const populated = types.filter((entry) => entry.count > 0);
        return text(
          `Connected to ${api.url}, analysis layer present, world loaded.\n\n` +
            `Object types:\n${populated.map((entry) => `  ${String(entry.count).padStart(7)}  ${entry.type}`).join("\n")}`,
        );
      } catch (error) {
        if (error instanceof AnalysisApiError && error.status === 409) {
          return text(`Connected to ${api.url}, analysis layer present, but no world is loaded. Use list_worlds then load_world.`);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "list_worlds",
    {
      title: "List known worlds",
      description:
        "Worlds LegendsViewer has opened before, with the XML path each one loads from. Use it to find the argument for load_world.",
      inputSchema: {},
    },
    async () => {
      const bookmarks = await api.getJson<Bookmark[]>("/api/Bookmark");
      if (bookmarks.length === 0) {
        return text("No world has been opened yet. Open one once in the LegendsViewer UI, or pass a full XML path to load_world.");
      }
      return text(
        bookmarks
          .map((bookmark) => `${bookmark.worldName ?? "(unnamed)"} [${bookmark.worldRegionName ?? "?"}] — ${bookmark.filePath ?? "?"}`)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "load_world",
    {
      title: "Load a world",
      description:
        "Parses a legends export into memory, replacing whatever world was loaded. Takes about 30 seconds and 800 MB for a large " +
        "world, so call it once and query afterwards. Point it at the -legends.xml file; the _plus.xml beside it is picked up automatically.",
      inputSchema: args({
        path: z.string().describe("Full path to the <world>-legends.xml file."),
      }),
    },
    async ({ path }) => {
      const bookmark = await api.postJson<Bookmark>("/api/Bookmark/loadByFullPath", path);
      return text(`Loaded ${bookmark?.worldName ?? "world"} from ${path}. Call world_summary next.`);
    },
  );

  server.registerTool(
    "world_summary",
    {
      title: "World summary",
      description:
        "Overview of the loaded world: totals per type, main civilizations, eras, largest wars, most eventful figures and the " +
        "most common event types. About 4 KB. The intended starting point before drilling into anything.",
      inputSchema: {},
    },
    async () => text(await api.getText("/api/Analysis/summary")),
  );

  server.registerTool(
    "read_object",
    {
      title: "Read one object",
      description:
        "The history of a single world object as prose. detail='digest' condenses it to the event type breakdown, an activity " +
        "histogram and only the events whose type is rare for that object — use it for civilizations and other large objects, " +
        "whose full dossier can exceed 600 KB. detail='full' returns everything.",
      inputSchema: args({
        type: z.string().describe('Object type, for example "HistoricalFigure", "Entity", "Site", "War".'),
        id: z.number().int().describe("Object id."),
        detail: z.enum(["full", "digest"]).default("digest").describe("How much to return."),
        maxEvents: z
          .number()
          .int()
          .optional()
          .describe("Cap on events (full) or on notable events (digest). 0 means no limit."),
        ...eventFilters,
      }),
    },
    async ({ type, id, detail, maxEvents, fromYear, toYear, eventTypes }) => {
      const route = detail === "full" ? "dossier" : "digest";
      const limitKey = detail === "full" ? "maxEvents" : "maxNotableEvents";
      return text(
        await api.getText(`/api/Analysis/${route}/${encodeURIComponent(type)}/${id}`, {
          [limitKey]: maxEvents,
          fromYear,
          toYear,
          eventTypes,
        }),
      );
    },
  );

  server.registerTool(
    "search_objects",
    {
      title: "Search by name",
      description: "Finds world objects whose name contains the query. Exact matches rank first, then prefixes, then event count.",
      inputSchema: args({
        q: z.string().describe("Substring of the name, case-insensitive."),
        type: z.string().optional().describe("Restrict to one object type."),
        limit: z.number().int().optional().describe("Maximum hits, default 25."),
      }),
    },
    async ({ q, type, limit }) => json(await api.getJson("/api/Analysis/search", { q, type, limit })),
  );

  server.registerTool(
    "search_properties",
    {
      title: "Search by property",
      description:
        "Searches the structured properties of objects — goal, race, positions, affiliations, worshipped deities — rather than " +
        "names or event text. These never appear in any event, so this is the only tool that finds them. Each hit reports which " +
        "field and value matched.",
      inputSchema: args({
        q: z.string().describe("Substring of the property value, case-insensitive."),
        type: z.string().optional().describe("Restrict to one object type."),
        field: z
          .string()
          .optional()
          .describe('Restrict to one property, using the key printed in brackets in a dossier, for example "goal" or "position".'),
        limit: z.number().int().optional().describe("Maximum hits, default 25."),
      }),
    },
    async ({ q, type, field, limit }) => json(await api.getJson("/api/Analysis/objects/search", { q, type, field, limit })),
  );

  server.registerTool(
    "search_events",
    {
      title: "Search event text",
      description:
        "Full text search over the prose of every event in the world — the only way to find deeds, as opposed to names or " +
        "properties. There is no index, so an unfiltered query on a large world takes a few seconds; passing eventTypes cuts " +
        "that to milliseconds because excluded events are never rendered. Omit q to read a span of history instead of " +
        "searching it: with fromYear/toYear alone it returns everything that happened then, and being free of any text to " +
        "match it is the fastest query here. Give q or a filter — neither would mean every event in the world.",
      inputSchema: args({
        q: z.string().optional().describe("Substring of the event prose, case-insensitive. Omit to take everything the filters admit."),
        limit: z.number().int().optional().describe("Maximum events shown, default 25."),
        ...eventFilters,
      }),
    },
    async ({ q, limit, fromYear, toYear, eventTypes }) =>
      text(await api.getText("/api/Analysis/events/search", { q, limit, fromYear, toYear, eventTypes })),
  );

  server.registerTool(
    "base_rates",
    {
      title: "Base rates of a property",
      description:
        "How common each value of a property is. Call it before concluding that a shared trait is meaningful: most properties " +
        "are recorded for only part of the objects, so the answer reports both the objects carrying the field and the whole " +
        "scope, and divides by the former. Omit field to list the queryable fields.",
      inputSchema: args({
        type: z.string().optional().describe("Restrict to one object type."),
        field: z.string().optional().describe("Property key. Omit to list the available fields."),
        limit: z.number().int().optional().describe("Maximum values returned, default 50."),
      }),
    },
    async ({ type, field, limit }) => json(await api.getJson("/api/Analysis/facets", { type, field, limit })),
  );

  server.registerTool(
    "rankings",
    {
      title: "Rank by a numeric measure",
      description:
        "Who holds the maximum of a measure — events, kills, worshippers, deaths and so on. Complements base_rates, which " +
        "orders by how many objects share a value rather than by the value itself. Returns total, min, median and max beside " +
        "the leaders, so a first place can be read against the spread. Omit by to list the available measures.",
      inputSchema: args({
        type: z.string().optional().describe("Restrict to one object type."),
        by: z.string().optional().describe("Measure name. Omit to list the available measures."),
        order: z.enum(["desc", "asc"]).optional().describe("Descending by default; asc for minima."),
        limit: z.number().int().optional().describe("Maximum entries, default 20."),
      }),
    },
    async ({ type, by, order, limit }) => json(await api.getJson("/api/Analysis/top", { type, by, order, limit })),
  );

  server.registerTool(
    "breakdown",
    {
      title: "Break one property down by another",
      description:
        "Groups objects by a property and, when measure names a numeric one, reports total, min, max, median and mean of it " +
        "within each group. base_rates and rankings each read a single property; this is the only way to ask a question over " +
        "two at once — age at death by caste, war casualties by attacker race, sites per civilization. field accepts any key " +
        "base_rates lists, measure any name rankings lists. Never reconstruct such a join by reading objects one by one. " +
        "Use where to narrow the population first: caste names such as Male are reused by every race, so grouping by caste " +
        "without where:race mixes populations that have nothing to do with each other.",
      inputSchema: args({
        type: z.string().optional().describe("Restrict to one object type."),
        field: z.string().describe("Property to group by, e.g. caste, race, attackerrace."),
        measure: z
          .string()
          .optional()
          .describe("Numeric measure to aggregate, e.g. ageatdeath, deathcount. Omit to count objects per group."),
        where: z
          .string()
          .optional()
          .describe("Restrict the population before grouping, as field:value, e.g. race:Orc. Matched whole, case insensitively."),
        limit: z.number().int().optional().describe("Maximum groups returned, default 50."),
      }),
    },
    async ({ type, field, measure, where, limit }) =>
      json(await api.getJson("/api/Analysis/crosstab", { type, field, measure, where, limit })),
  );

  return server;
}
