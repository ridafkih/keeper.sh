import { createDigestClient, selectChallenge } from "@keeper.sh/digest-fetch";
import type { CalDAVAuthMethod, CalDAVCredentials } from "../dependencies";
import { releaseResponseBody } from "./response-body";

interface AuthenticatingFetchOptions {
  readonly fetch: typeof fetch;
  readonly credentials: CalDAVCredentials;
  readonly onAuthMethodResolved: (method: CalDAVAuthMethod) => void;
}

const unauthorised = 401;

const schemeSent = (headers: Headers): CalDAVAuthMethod | null => {
  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }
  if (authorization.startsWith("Digest ")) {
    return "digest";
  }
  if (authorization.startsWith("Basic ")) {
    return "basic";
  }
  return null;
};

const presentable = (credentials: CalDAVCredentials): boolean =>
  credentials.username.length > 0 && credentials.password.length > 0;

const basicHeaders = (init: RequestInit | undefined, credentials: CalDAVCredentials): Headers => {
  const headers = new Headers(init?.headers);
  headers.set(
    "authorization",
    `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
  );
  return headers;
};

const signalOf = (init: RequestInit | undefined): AbortSignal | null => {
  const carried = init?.signal;
  if (!carried) {
    return null;
  }
  return carried;
};

const untilAborted = (signal: AbortSignal): Promise<never> =>
  new Promise<never>((resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(signal.reason);
    });
  });

interface AuthNegotiation {
  announced: CalDAVAuthMethod | null;
  resolved: CalDAVAuthMethod | null;
  challenge: string | null;
  negotiating: Promise<void> | null;
}

const createAuthenticatingFetch = (options: AuthenticatingFetchOptions): typeof fetch => {
  const { credentials } = options;
  const auth: AuthNegotiation = {
    announced: credentials.knownAuthMethod,
    resolved: null,
    challenge: null,
    negotiating: null,
  };

  const announce = (method: CalDAVAuthMethod): void => {
    auth.resolved = method;
    if (auth.announced === method) {
      return;
    }
    auth.announced = method;
    options.onAuthMethodResolved(method);
  };

  const replayedChallenge = (): Response =>
    new Response(null, { status: unauthorised, headers: { "www-authenticate": auth.challenge ?? "" } });

  const observing = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const sent = schemeSent(new Headers(init?.headers));
    if (sent === null && auth.challenge !== null) {
      return Promise.resolve(replayedChallenge());
    }
    if (sent !== null) {
      announce(sent);
    }
    return options.fetch(input, init);
  };

  const digest = createDigestClient({
    user: credentials.username,
    password: credentials.password,
    fetch: observing,
  });

  const overBasic = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    observing(input, { ...init, headers: basicHeaders(init, credentials) });

  const negotiate = async (
    input: string | URL | Request,
    init: RequestInit | undefined,
    answered: Response,
  ): Promise<Response> => {
    const offered = selectChallenge(answered.headers.get("www-authenticate"), "Basic");
    if (!offered) {
      return answered;
    }
    await releaseResponseBody(answered);
    return overBasic(input, init);
  };

  const probeChallenge = async (signal: AbortSignal | null): Promise<void> => {
    const probed = await options.fetch(credentials.serverUrl, {
      method: "OPTIONS",
      signal: signal ?? null,
    });
    if (probed.status === unauthorised) {
      auth.challenge = probed.headers.get("www-authenticate");
      if (selectChallenge(auth.challenge, "Digest") === null) {
        auth.resolved = "basic";
      }
    }
    await releaseResponseBody(probed);
  };


  const forgetProbe = (): void => {
    auth.negotiating = null;
  };

  const negotiated = (signal: AbortSignal | null): Promise<void> => {
    if (auth.negotiating) {
      return auth.negotiating;
    }
    const probing = probeChallenge(signal);
    auth.negotiating = probing;
    probing.catch(forgetProbe);
    return probing;
  };

  const negotiatedOrAbandoned = (signal: AbortSignal | null): Promise<void> => {
    if (signal === null) {
      return negotiated(null);
    }
    return Promise.race([negotiated(signal), untilAborted(signal)]);
  };

  const authenticating = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!presentable(credentials)) {
      return observing(input, init);
    }
    const signal = signalOf(init);
    signal?.throwIfAborted();
    await negotiatedOrAbandoned(signal);
    if (auth.resolved === "basic") {
      return overBasic(input, init);
    }
    const answered = await digest.fetch(input, init);
    if (answered.status !== unauthorised) {
      return answered;
    }
    return negotiate(input, init, answered);
  };

  return Object.assign(authenticating, {
    preconnect: (): Promise<void> => Promise.resolve(),
  });
};

export { createAuthenticatingFetch };
export type { AuthenticatingFetchOptions };
