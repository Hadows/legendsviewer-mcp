/**
 * Thin HTTP client for the LegendsViewer analysis API.
 *
 * The server owns no world state: LegendsViewer keeps the parsed world in memory and this client
 * only queries it. The value added here is turning the three failure modes a caller actually hits —
 * backend down, backend without the analysis layer, no world loaded — into messages that say what
 * to do next, since an MCP client sees only the text we return.
 */

export const DEFAULT_BASE_URL = "http://localhost:15421";

export class AnalysisApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AnalysisApiError";
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export class AnalysisApi {
  constructor(private readonly baseUrl: string = process.env.LEGENDSVIEWER_URL ?? DEFAULT_BASE_URL) {
    this.baseUrl = this.baseUrl.replace(/\/+$/, "");
  }

  get url(): string {
    return this.baseUrl;
  }

  async getText(path: string, params: QueryParams = {}): Promise<string> {
    const response = await this.request(path, params);
    return response.text();
  }

  async getJson<T>(path: string, params: QueryParams = {}): Promise<T> {
    const response = await this.request(path, params);
    return response.json() as Promise<T>;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async request(path: string, params: QueryParams, init: RequestInit = {}): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      throw new AnalysisApiError(
        `Cannot reach LegendsViewer at ${this.baseUrl}. Start it with "dotnet run --project LegendsViewer.Backend", ` +
          `or set LEGENDSVIEWER_URL if it listens elsewhere. (${(cause as Error).message})`,
      );
    }

    if (response.ok) {
      return response;
    }

    throw new AnalysisApiError(await describeFailure(response, path), response.status);
  }
}

async function describeFailure(response: Response, path: string): Promise<string> {
  const body = (await response.text()).trim();

  if (response.status === 409) {
    return "No world is loaded. Call list_worlds to see the known exports, then load_world.";
  }

  if (response.status === 404 && path.startsWith("/api/Analysis")) {
    return (
      "This LegendsViewer instance has no analysis layer, or the id does not exist. " +
      "The layer ships with LegendsViewer-AIPowered; a stock LegendsViewer-Next will not answer these routes. " +
      (body || "")
    ).trim();
  }

  if (response.status === 400) {
    // The API answers 400 by naming the discovery route that lists valid values; pass it through.
    return body || "Bad request.";
  }

  return `LegendsViewer answered ${response.status}${body ? `: ${body}` : ""}`;
}
