import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalysisApi } from "./api.js";
import { createServer } from "./server.js";

/** Records the calls the tools make, so the tests assert on routes instead of on HTTP. */
class RecordingApi extends AnalysisApi {
  readonly calls: { path: string; params: Record<string, unknown> }[] = [];
  responses: Record<string, unknown> = {};

  constructor() {
    super("http://localhost:15421");
  }

  override async getText(path: string, params: Record<string, never> = {}): Promise<string> {
    this.calls.push({ path, params });
    return (this.responses[path] as string) ?? "text response";
  }

  override async getJson<T>(path: string, params: Record<string, never> = {}): Promise<T> {
    this.calls.push({ path, params });
    return (this.responses[path] ?? []) as T;
  }

  override async postJson<T>(path: string, body: unknown): Promise<T> {
    this.calls.push({ path, params: { body } });
    return (this.responses[path] ?? {}) as T;
  }
}

async function connect(api: RecordingApi) {
  const server = createServer(api);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

let api: RecordingApi;

beforeEach(() => {
  api = new RecordingApi();
});

describe("MCP surface", () => {
  it("exposes the expected tools", async () => {
    const client = await connect(api);

    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      "base_rates",
      "list_worlds",
      "load_world",
      "rankings",
      "read_object",
      "search_events",
      "search_objects",
      "search_properties",
      "world_status",
      "world_summary",
    ]);
  });

  it("describes every tool, since the description is all a model has to choose by", async () => {
    const client = await connect(api);

    for (const tool of (await client.listTools()).tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} description is too short`).toBeGreaterThan(40);
    }
  });

  it("defaults read_object to the digest and maps the limit to the right parameter", async () => {
    const client = await connect(api);

    await client.callTool({ name: "read_object", arguments: { type: "Entity", id: 88, maxEvents: 10 } });

    expect(api.calls[0]!.path).toBe("/api/Analysis/digest/Entity/88");
    expect(api.calls[0]!.params).toMatchObject({ maxNotableEvents: 10 });
  });

  it("routes read_object to the dossier when full detail is asked", async () => {
    const client = await connect(api);

    await client.callTool({ name: "read_object", arguments: { type: "HistoricalFigure", id: 116, detail: "full", maxEvents: 0 } });

    expect(api.calls[0]!.path).toBe("/api/Analysis/dossier/HistoricalFigure/116");
    expect(api.calls[0]!.params).toMatchObject({ maxEvents: 0 });
  });

  it("forwards the shared event filters", async () => {
    const client = await connect(api);

    await client.callTool({
      name: "search_events",
      arguments: { q: "toppled", fromYear: 100, toYear: 200, eventTypes: "entity overthrown" },
    });

    expect(api.calls[0]!.path).toBe("/api/Analysis/events/search");
    expect(api.calls[0]!.params).toMatchObject({ q: "toppled", fromYear: 100, toYear: 200, eventTypes: "entity overthrown" });
  });

  it("reports a missing world as guidance rather than as a failure", async () => {
    api.getJson = async () => {
      throw Object.assign(new Error("No world is loaded."), { name: "AnalysisApiError", status: 409 });
    };
    // Re-create with the patched method in place.
    const client = await connect(api);

    const result = await client.callTool({ name: "world_status", arguments: {} });

    expect(JSON.stringify(result.content)).toMatch(/no world is loaded|No world is loaded/i);
  });

  it("tells the caller a load takes time and what to do next", async () => {
    api.responses["/api/Bookmark/loadByFullPath"] = { worldName: "Orid En" };
    const client = await connect(api);

    const result = await client.callTool({ name: "load_world", arguments: { path: "C:/w-legends.xml" } });

    expect(JSON.stringify(result.content)).toMatch(/Orid En/);
    expect(api.calls[0]!.path).toBe("/api/Bookmark/loadByFullPath");
  });
});
