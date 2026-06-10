import { CryptoHasher } from "bun";

const md5 = (data: string): string =>
  new CryptoHasher("md5").update(data).digest("hex");

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
  nonceCount: number;
  scheme: string;
  realm: string;
  nonce: string;
  clientNonce: string;
  qualityOfProtection: string | null;
  opaque: string | null;
}

const parseChallenge = (header: string): DigestChallenge => ({
  nonceCount: 1,
  scheme: header.split(/\s/)[0] ?? "Digest",
  realm: parseRealm(header),
  qualityOfProtection: parseQualityOfProtection(header),
  opaque: parseField(header, "opaque"),
  nonce: parseField(header, "nonce") ?? "",
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
): string => {
  const hashA1 = md5(`${username}:${challenge.realm}:${password}`);
  const hashA2 = md5(`${method}:${uri}`);
  const nonceCount = String(challenge.nonceCount).padStart(8, "0");
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

const isDigestChallenge = (header: string | null): header is string => {
  if (!header) {
    return false;
  }

  return /^Digest\s/i.test(header);
};

const createDigestClient = (options: DigestClientOptions) => {
  const { user, password } = options;
  const baseFetch = options.fetch;
  let challenge: DigestChallenge | null = null;

  const authenticatedFetch = (
    currentChallenge: DigestChallenge,
    input: string | Request | URL,
    init: RequestInit | undefined,
    method: string,
    uri: string,
  ): Promise<Response> => {
    const authorization = buildAuthorizationHeader(
      currentChallenge,
      user,
      password,
      method,
      uri,
    );
    const headers = new Headers(init?.headers);
    headers.set("authorization", authorization);
    return baseFetch(input, { ...init, headers });
  };

  const digestFetch: FetchFunction = async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);
    const uri = `${parsed.pathname}${parsed.search}`;
    const method = init?.method?.toUpperCase() ?? "GET";

    if (challenge) {
      const response = await authenticatedFetch(
        challenge,
        input,
        init,
        method,
        uri,
      );

      if (response.status !== 401) {
        challenge.nonceCount++;
        return response;
      }

      const wwwAuthenticate = response.headers.get("www-authenticate");

      if (!isDigestChallenge(wwwAuthenticate)) {
        return response;
      }

      await response.body?.cancel();
      challenge = parseChallenge(wwwAuthenticate);
      const retryResponse = await authenticatedFetch(
        challenge,
        input,
        init,
        method,
        uri,
      );
      challenge.nonceCount++;
      return retryResponse;
    }

    const initialResponse = await baseFetch(input, init);

    if (initialResponse.status !== 401) {
      return initialResponse;
    }

    const wwwAuthenticate = initialResponse.headers.get("www-authenticate");

    if (!isDigestChallenge(wwwAuthenticate)) {
      return initialResponse;
    }

    await initialResponse.body?.cancel();
    challenge = parseChallenge(wwwAuthenticate);
    const retryResponse = await authenticatedFetch(
      challenge,
      input,
      init,
      method,
      uri,
    );
    challenge.nonceCount++;
    return retryResponse;
  };

  return { fetch: digestFetch };
};

export { createDigestClient };
export type { FetchFunction };
