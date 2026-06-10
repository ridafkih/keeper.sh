import { createDigestClient } from "@keeper.sh/digest-fetch";

type FetchFunction = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

type AuthMethod = "unknown" | "basic" | "digest";

const HTTP_UNAUTHORIZED = 401;

interface DigestFetchCredentials {
  username: string;
  password: string;
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
  getResolvedMethod: () => CalDAVAuthMethod | null;
}

const createDigestAwareFetch = (options: DigestAwareFetchOptions): DigestAwareFetchResult => {
  const { credentials, baseFetch, knownAuthMethod } = options;
  const basicAuth = encodeBasicCredentials(credentials.username, credentials.password);
  const digestClient = createDigestClient({
    user: credentials.username,
    password: credentials.password,
    fetch: baseFetch,
  });

  const state: { method: AuthMethod } = { method: knownAuthMethod ?? "unknown" };

  const performFetch: FetchFunction = async (input, init) => {
    if (state.method === "digest") {
      return digestClient.fetch(input, init);
    }

    const headers = mergeHeaders(init, { authorization: basicAuth });
    const response = await baseFetch(input, { ...init, headers });

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

  const getResolvedMethod = (): CalDAVAuthMethod | null => {
    if (state.method === "unknown") {
      return null;
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
