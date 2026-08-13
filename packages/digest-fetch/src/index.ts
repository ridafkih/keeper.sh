import { CryptoHasher } from "bun";

const md5 = (data: string): string =>
  new CryptoHasher("md5").update(data).digest("hex");

interface AuthChallenge {
  scheme: string;
  params: string;
}

const AUTH_PARAM_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+\s*=/;
const AUTH_SCHEME_PATTERN =
  /^([A-Za-z][A-Za-z0-9!#$%&'*+\-.^_`|~]*)(?:\s+([\S\s]*))?$/;

const CHALLENGE_SEGMENT_PATTERN = /(?:[^,"]|"[^"]*")+/g;

const splitChallengeSegments = (header: string): string[] =>
  (header.match(CHALLENGE_SEGMENT_PATTERN) ?? [])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const parseChallengeList = (header: string): AuthChallenge[] => {
  const segments = splitChallengeSegments(header);
  const schemeIndexes = segments
    .map((segment, index) => ({ index, segment }))
    .filter(({ segment }) => !AUTH_PARAM_PATTERN.test(segment))
    .map(({ index }) => index);

  return schemeIndexes.flatMap((start, position) => {
    const match = AUTH_SCHEME_PATTERN.exec(segments[start] ?? "");

    if (!match?.[1]) {
      return [];
    }

    const end = schemeIndexes[position + 1] ?? segments.length;
    const params = [match[2] ?? "", ...segments.slice(start + 1, end)]
      .filter(Boolean)
      .join(", ");

    return [{ params, scheme: match[1] }];
  });
};

const selectChallenge = (
  header: string | null,
  scheme: string,
): AuthChallenge | null => {
  if (!header) {
    return null;
  }

  const target = scheme.toLowerCase();

  return (
    parseChallengeList(header).find(
      (challenge) => challenge.scheme.toLowerCase() === target,
    ) ?? null
  );
};

const parseField = (
  header: string,
  field: string,
  trim = true,
): string | null => {
  const regex = new RegExp(`${field}=("[^"]*"|[^,]*)`, "i");
  const match = regex.exec(header);

  if (!match?.[1]) {
    return null;
  }

  if (trim) {
    return match[1].replaceAll(/[\s"]/g, "");
  }

  return match[1];
};

const parseRealm = (header: string): string => {
  const match = parseField(header, "realm", false);

  if (!match) {
    return "";
  }

  return match.replaceAll('"', "");
};

const parseQualityOfProtection = (header: string): string | null => {
  const value = parseField(header, "qop");

  if (!value) {
    return null;
  }

  const options = value.split(",");

  if (options.includes("auth")) {
    return "auth";
  }

  if (options.includes("auth-int")) {
    return "auth-int";
  }

  return null;
};

const generateClientNonce = (size = 32): string => {
  const hexChars = "abcdef0123456789";
  let result = "";

  for (let index = 0; index < size; index++) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }

  return result;
};

interface DigestChallenge {
  scheme: string;
  realm: string;
  nonce: string;
  clientNonce: string;
  qualityOfProtection: string | null;
  opaque: string | null;
}

const parseChallenge = (challenge: AuthChallenge): DigestChallenge => ({
  scheme: challenge.scheme,
  realm: parseRealm(challenge.params),
  qualityOfProtection: parseQualityOfProtection(challenge.params),
  opaque: parseField(challenge.params, "opaque"),
  nonce: parseField(challenge.params, "nonce") ?? "",
  clientNonce: generateClientNonce(),
});

const computeResponseHash = (
  challenge: DigestChallenge,
  hashA1: string,
  hashA2: string,
  nonceCount: string,
): string => {
  if (!challenge.qualityOfProtection) {
    return md5(`${hashA1}:${challenge.nonce}:${hashA2}`);
  }

  return md5(
    `${hashA1}:${challenge.nonce}:${nonceCount}:${challenge.clientNonce}:${challenge.qualityOfProtection}:${hashA2}`,
  );
};

const buildAuthorizationHeader = (
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string,
  nonceCountValue: number,
): string => {
  const hashA1 = md5(`${username}:${challenge.realm}:${password}`);
  const hashA2 = md5(`${method}:${uri}`);
  const nonceCount = String(nonceCountValue).padStart(8, "0");
  const responseHash = computeResponseHash(
    challenge,
    hashA1,
    hashA2,
    nonceCount,
  );

  let opaqueDirective = "";

  if (challenge.opaque) {
    opaqueDirective = `opaque="${challenge.opaque}",`;
  }

  let qopDirective = "";

  if (challenge.qualityOfProtection) {
    qopDirective = `qop=${challenge.qualityOfProtection},`;
  }

  return [
    `${challenge.scheme} username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `${opaqueDirective}${qopDirective}algorithm=MD5`,
    `response="${responseHash}"`,
    `nc=${nonceCount}`,
    `cnonce="${challenge.clientNonce}"`,
  ].join(",");
};

type FetchFunction = (
  input: string | Request | URL,
  init?: RequestInit,
) => Promise<Response>;

interface DigestClientOptions {
  user: string;
  password: string;
  fetch: FetchFunction;
}

const selectDigestChallenge = (header: string | null): AuthChallenge | null =>
  selectChallenge(header, "Digest");

interface DigestSession {
  challenge: DigestChallenge;
  nonceCount: number;
}

const createDigestClient = (options: DigestClientOptions) => {
  const { user, password } = options;
  const baseFetch = options.fetch;
  let session: DigestSession | null = null;

  const openSession = (parsed: AuthChallenge): DigestSession => {
    const challenge = parseChallenge(parsed);

    if (session && session.challenge.nonce === challenge.nonce) {
      return session;
    }

    session = { challenge, nonceCount: 0 };
    return session;
  };

  const authenticatedFetch = (
    current: DigestSession,
    input: string | Request | URL,
    init: RequestInit | undefined,
    method: string,
    uri: string,
  ): Promise<Response> => {
    current.nonceCount += 1;
    const authorization = buildAuthorizationHeader(
      current.challenge,
      user,
      password,
      method,
      uri,
      current.nonceCount,
    );
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorization);
    return baseFetch(input, { ...init, headers });
  };

  const renegotiate = async (
    response: Response,
    input: string | Request | URL,
    init: RequestInit | undefined,
    method: string,
    uri: string,
  ): Promise<Response> => {
    const parsed = selectDigestChallenge(response.headers.get("www-authenticate"));

    if (!parsed) {
      return response;
    }

    await response.body?.cancel();
    return authenticatedFetch(openSession(parsed), input, init, method, uri);
  };

  const digestFetch: FetchFunction = async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);
    const uri = `${parsed.pathname}${parsed.search}`;
    const method = init?.method?.toUpperCase() ?? "GET";
    const current = session;

    const attempt = (): Promise<Response> => {
      if (!current) {
        return baseFetch(input, init);
      }
      return authenticatedFetch(current, input, init, method, uri);
    };

    const response = await attempt();

    if (response.status !== 401) {
      return response;
    }

    return renegotiate(response, input, init, method, uri);
  };

  return { fetch: digestFetch };
};

export { createDigestClient, selectChallenge };
export type { AuthChallenge, FetchFunction };
