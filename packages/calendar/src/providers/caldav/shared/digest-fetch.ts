import { DigestClient } from "digest-fetch";

interface DigestFetchCredentials {
  username: string;
  password: string;
}

type FetchFunction = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

class SafeDigestClient extends DigestClient {
  private safeFetch: FetchFunction;

  constructor(username: string, password: string, safeFetch: FetchFunction) {
    super(username, password);
    this.safeFetch = safeFetch;
  }

  override async getClient(): Promise<FetchFunction> {
    return this.safeFetch;
  }
}

const createDigestAwareFetch = (
  credentials: DigestFetchCredentials,
  baseFetch?: FetchFunction,
): FetchFunction => {
  const fetchFn = baseFetch ?? globalThis.fetch;
  const client = new SafeDigestClient(credentials.username, credentials.password, fetchFn);

  const performFetch: FetchFunction = (input, init) => {
    return client.fetch(input, init);
  };

  return performFetch;
};

export { createDigestAwareFetch };
