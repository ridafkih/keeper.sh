export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`${status} ${url}`);
    this.name = "HttpError";
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new HttpError(response.status, url);
  return response.json();
}

export async function apiFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const response = await fetch(url, { credentials: "include", ...options });
  if (!response.ok) throw new HttpError(response.status, url);
  return response;
}
