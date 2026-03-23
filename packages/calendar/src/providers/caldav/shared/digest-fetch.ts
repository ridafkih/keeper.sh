import { DigestClient } from "digest-fetch";

interface DigestFetchCredentials {
  username: string;
  password: string;
}

type FetchFunction = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

type AuthMethod = "unknown" | "basic" | "digest";

const HTTP_UNAUTHORIZED = 401;

const extractUri = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

class SafeDigestClient extends DigestClient {
  private safeFetch: FetchFunction;

  constructor(username: string, password: string, safeFetch: FetchFunction) {
    super(username, password);
    this.safeFetch = safeFetch;
  }

  override async getClient(): Promise<FetchFunction> {
    return this.safeFetch;
  }

  override addAuth(url: unknown, options: Record<string, unknown>): Record<string, unknown> {
    const urlStr = typeof url === "string" ? url : String(url);
    const pathOnly = extractUri(urlStr);
    return super.addAuth(pathOnly, options);
  }
}

const encodeBasicCredentials = (username: string, password: string): string => {
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${encoded}`;
};

const mergeHeaders = (
  init: RequestInit | undefined,
  extra: Record<string, string>,
): Record<string, string> => {
  const merged: Record<string, string> = {};
  const existing = new Headers(init?.headers);
  for (const [key, value] of existing.entries()) {
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = value;
  }
  return merged;
};

const isDigestChallenge = (response: Response): boolean => {
  const header = response.headers.get("www-authenticate");
  if (!header) {
    return false;
  }
  return /^Digest\s/i.test(header);
};

interface DigestAwareFetchOptions {
  credentials: DigestFetchCredentials;
  baseFetch: FetchFunction;
  knownAuthMethod?: "basic" | "digest";
}

interface DigestAwareFetchResult {
  fetch: FetchFunction;
  getResolvedMethod: () => CalDAVAuthMethod | undefined;
}

const createDigestAwareFetch = (options: DigestAwareFetchOptions): DigestAwareFetchResult => {
  const { credentials, baseFetch, knownAuthMethod } = options;
  const fetchFn = baseFetch;
  const digestClient = new SafeDigestClient(credentials.username, credentials.password, fetchFn);
  const basicAuth = encodeBasicCredentials(credentials.username, credentials.password);

  const state: { method: AuthMethod } = { method: knownAuthMethod ?? "unknown" };

  const performFetch: FetchFunction = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    console.log(`[digest-fetch] method=${state.method} url=${url} httpMethod=${init?.method ?? "GET"}`);

    if (state.method === "digest") {
      const digestResponse = await digestClient.fetch(input, init);
      console.log(`[digest-fetch] digest response: ${digestResponse.status} ${digestResponse.statusText}`);
      return digestResponse;
    }

    const headers = mergeHeaders(init, { authorization: basicAuth });
    const response = await fetchFn(input, { ...init, headers });
    console.log(`[digest-fetch] basic probe: ${response.status} www-auth=${response.headers.get("www-authenticate")?.substring(0, 80)}`);

    if (state.method === "basic") {
      return response;
    }

    if (response.status !== HTTP_UNAUTHORIZED) {
      if (state.method === "unknown" && response.ok) {
        state.method = "basic";
      }
      return response;
    }

    if (!isDigestChallenge(response)) {
      return response;
    }

    await response.body?.cancel();
    state.method = "digest";
    return digestClient.fetch(input, init);
  };

  const getResolvedMethod = (): CalDAVAuthMethod | undefined => {
    if (state.method === "unknown") {
      return undefined;
    }
    return state.method;
  };

  return { fetch: performFetch, getResolvedMethod };
};

type CalDAVAuthMethod = "basic" | "digest";

const resolveAuthMethod = (value: string): CalDAVAuthMethod => {
  if (value === "digest") {
    return "digest";
  }
  return "basic";
};

export { createDigestAwareFetch, resolveAuthMethod };
export type { CalDAVAuthMethod };
