import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisApi, AnalysisApiError } from "./api.js";

const BASE = "http://localhost:15421";

function mockFetch(response: Response | Error) {
  const spy = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnalysisApi", () => {
  it("builds the query string and drops empty parameters", async () => {
    const spy = mockFetch(new Response("ok"));

    await new AnalysisApi(BASE).getText("/api/Analysis/summary", {
      q: "toppled",
      limit: 5,
      fromYear: undefined,
      eventTypes: "",
    });

    const url = new URL(spy.mock.calls[0]![0] as unknown as string);
    expect(url.pathname).toBe("/api/Analysis/summary");
    expect(url.searchParams.get("q")).toBe("toppled");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("fromYear")).toBe(false);
    expect(url.searchParams.has("eventTypes")).toBe(false);
  });

  it("trims a trailing slash from the base url", () => {
    expect(new AnalysisApi("http://localhost:15421/").url).toBe(BASE);
  });

  it("turns an unreachable backend into an actionable message", async () => {
    mockFetch(new TypeError("fetch failed"));

    await expect(new AnalysisApi(BASE).getText("/api/Analysis/summary")).rejects.toThrow(/Cannot reach LegendsViewer/);
  });

  it("explains a 409 as a missing world rather than an error", async () => {
    mockFetch(new Response("No world is loaded.", { status: 409 }));

    await expect(new AnalysisApi(BASE).getText("/api/Analysis/summary")).rejects.toThrow(/list_worlds.*load_world/s);
  });

  it("explains a 404 on an analysis route as a possibly stock LegendsViewer", async () => {
    mockFetch(new Response("", { status: 404 }));

    await expect(new AnalysisApi(BASE).getText("/api/Analysis/types")).rejects.toThrow(/no analysis layer/);
  });

  it("passes a 400 body through, since the API names the discovery route", async () => {
    mockFetch(new Response("No values for field 'nope'. Call /api/Analysis/facets without 'field'.", { status: 400 }));

    await expect(new AnalysisApi(BASE).getJson("/api/Analysis/facets", { field: "nope" })).rejects.toThrow(
      /without 'field'/,
    );
  });

  it("reports the status code on the error", async () => {
    mockFetch(new Response("boom", { status: 500 }));

    const error = await new AnalysisApi(BASE).getText("/api/Analysis/summary").catch((e) => e);
    expect(error).toBeInstanceOf(AnalysisApiError);
    expect((error as AnalysisApiError).status).toBe(500);
  });

  it("posts a JSON body", async () => {
    const spy = mockFetch(new Response(JSON.stringify({ worldName: "Orid En" })));

    const result = await new AnalysisApi(BASE).postJson<{ worldName: string }>("/api/Bookmark/loadByFullPath", "C:\\w.xml");

    expect(spy.mock.calls[0]![1]).toMatchObject({ method: "POST", body: JSON.stringify("C:\\w.xml") });
    expect(result.worldName).toBe("Orid En");
  });
});
