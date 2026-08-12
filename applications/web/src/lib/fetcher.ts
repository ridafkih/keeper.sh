export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly serverMessage: string | null = null,
  ) {
    super(`${status} ${url}`);
    this.name = "HttpError";
  }
}

function extractServerMessage(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object" || value === null) return null;

  const { error, message } = value as Record<string, unknown>;
  return extractServerMessage(error) ?? extractServerMessage(message);
}

async function readServerMessage(
  response: Response,
  url: string,
): Promise<string | null> {
  if (response.status < 400 || response.status >= 500) return null;

  try {
    const body = (await response.text()).trim();
    if (!body.startsWith("{")) return null;
    return extractServerMessage(JSON.parse(body));
  } catch (error) {
    console.error(`[fetcher] ${response.status} ${url}: unreadable error body`, error);
    return null;
  }
}

export async function createHttpError(
  response: Response,
  url: string,
): Promise<HttpError> {
  return new HttpError(response.status, url, await readServerMessage(response, url));
}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw await createHttpError(response, url);
  return response.json();
}

export async function apiFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const response = await fetch(url, { credentials: "include", ...options });
  if (!response.ok) throw await createHttpError(response, url);
  return response;
}
