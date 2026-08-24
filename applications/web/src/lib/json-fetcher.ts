import { HttpError, readHttpErrorBody } from "./fetcher";
import type { AppJsonFetcher } from "./router-context";

function createJsonFetcher(
  requestCookie: string | null,
  origin: string,
): AppJsonFetcher {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const requestHeaders = new Headers(init.headers);
    if (requestCookie && !requestHeaders.has("cookie")) {
      requestHeaders.set("cookie", requestCookie);
    }

    const absoluteUrl = new URL(path, origin).toString();
    const response = await fetch(absoluteUrl, {
      ...init,
      credentials: "include",
      headers: requestHeaders,
    });

    if (!response.ok) {
      throw new HttpError(response.status, path, await readHttpErrorBody(response));
    }

    return response.json() as Promise<T>;
  };
}

export { createJsonFetcher };
