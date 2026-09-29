import type { SafeFetchOptions } from "../../utils/safe-fetch";

interface EwsApplicationAuth {
  type: "oauth2-client-credentials";
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

interface EwsUserAuth {
  type: "oauth2-user";
  deviceAuthorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
}
interface EwsNtlmAuth {
  type: "ntlm";
  username: string;
  password: string;
}
type EwsAuth = EwsApplicationAuth | EwsUserAuth | EwsNtlmAuth;

interface EwsConfig {
  serverUrl: string;
  auth: EwsAuth;
  mailbox?: string;
  impersonate?: string;
  anchorMailbox?: string;
  serverVersion?:
    | "Exchange2010_SP2"
    | "Exchange2013"
    | "Exchange2013_SP1"
    | "Exchange2016";
  syncIntervalSeconds?: number;
  pageSize?: number;
  maxRequests?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  minimumIntervalMs?: number;
}

interface EwsRuntimeOptions {
  safeFetchOptions?: SafeFetchOptions;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  getAccessToken?: (config: EwsConfig) => Promise<string>;
  onBeforeRequest?: () => Promise<void> | void;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid EWS configuration");
  }
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\r\n]/u.test(value) ||
    value.includes(String.fromCodePoint(0))
  ) {
    throw new Error("Missing or invalid EWS configuration field");
  }
  return value;
};
const httpsUrl = (value: unknown): string => {
  const url = new URL(required(value));
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(
      "EWS and OAuth endpoints must be HTTPS URLs without embedded credentials or fragments",
    );
  }
  return url.href;
};

const parseAuth = (auth: Record<string, unknown>): EwsAuth => {
  if (auth.type === "ntlm") {
    const username = required(auth.username);
    if (username.includes(":")) {
      throw new Error("Invalid NTLM username");
    }
    return { type: "ntlm", username, password: required(auth.password) };
  }
  if (
    auth.type !== "oauth2-client-credentials" &&
    auth.type !== "oauth2-user"
  ) {
    throw new Error("Unsupported EWS authentication type");
  }
  const common = {
    tokenUrl: httpsUrl(auth.tokenUrl),
    clientId: required(auth.clientId),
    scope: required(auth.scope),
  };
  let parsedAuth: EwsApplicationAuth | EwsUserAuth = {
    ...common,
    type: "oauth2-client-credentials",
    clientSecret: "",
  };
  if (auth.type === "oauth2-user") {
    parsedAuth = {
      ...common,
      type: auth.type,
      deviceAuthorizationUrl: httpsUrl(auth.deviceAuthorizationUrl),
    };
    for (const key of [
      "clientSecret",
      "refreshToken",
      "accessToken",
    ] as const) {
      if (key in auth) {
        parsedAuth[key] = required(auth[key]);
      }
    }
    if ("expiresAt" in auth) {
      if (
        typeof auth.expiresAt !== "number" ||
        !Number.isFinite(auth.expiresAt) ||
        auth.expiresAt <= 0
      ) {
        throw new Error("Invalid token expiry");
      }
      parsedAuth.expiresAt = auth.expiresAt;
    }
  } else {
    parsedAuth = {
      ...common,
      type: auth.type,
      clientSecret: required(auth.clientSecret),
    };
  }
  return parsedAuth;
};

const parseEwsConfig = (input: unknown): EwsConfig => {
  const value = record(input);
  const auth = record(value.auth);
  const parsedAuth = parseAuth(auth);
  const config: EwsConfig = {
    serverUrl: httpsUrl(value.serverUrl),
    auth: parsedAuth,
  };
  for (const key of ["mailbox", "impersonate", "anchorMailbox"] as const) {
    if (value[key]) {
      config[key] = required(value[key]);
    }
  }
  if (value.serverVersion) {
    const version = required(value.serverVersion);
    if (
      ![
        "Exchange2010_SP2",
        "Exchange2013",
        "Exchange2013_SP1",
        "Exchange2016",
      ].includes(version)
    ) {
      throw new Error("Unsupported EWS schema version");
    }
    config.serverVersion = version as EwsConfig["serverVersion"];
  }
  const bounds = {
    syncIntervalSeconds: [30, 86_400],
    pageSize: [1, 1000],
    maxRequests: [1, 10_000],
    maxResponseBytes: [1024, 16_777_216],
    timeoutMs: [1000, 120_000],
    minimumIntervalMs: [0, 60_000],
  } as const;
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    if (!(key in value)) {
      continue;
    }
    const number = value[key];
    const [min, max] = bounds[key];
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number < min ||
      number > max
    ) {
      throw new Error(`Invalid EWS ${key}`);
    }
    config[key] = number;
  }
  return config;
};

const ewsConnectionIdentity = (config: EwsConfig): string => {
  const authIdentity = (): string | string[] => {
    if (config.auth.type === "ntlm") { return ["ntlm", config.auth.username]; }
    return config.auth.clientId;
  };
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify([
        config.serverUrl,
        config.mailbox ?? "",
        config.impersonate ?? "",
        authIdentity(),
      ]),
    )
    .digest("hex");
};

export { parseEwsConfig, ewsConnectionIdentity };
export type { EwsUserAuth, EwsAuth, EwsConfig, EwsRuntimeOptions };
