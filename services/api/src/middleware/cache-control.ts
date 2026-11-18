import type { MaybePromise } from "bun";

const DEFAULT_CACHE_CONTROL = "no-store";

type FetchHandler = (request: Request) => MaybePromise<Response | undefined>;

const withDefaultCacheControl = (handler: FetchHandler): FetchHandler =>
  async (request): Promise<Response | undefined> => {
    const response = await handler(request);

    if (!response || response.headers.has("Cache-Control")) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", DEFAULT_CACHE_CONTROL);

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };

export { DEFAULT_CACHE_CONTROL, withDefaultCacheControl };
