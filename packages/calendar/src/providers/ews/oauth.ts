import { createSafeFetch } from "../../utils/safe-fetch";
import type { EwsConfig, EwsRuntimeOptions, EwsUserAuth } from "./config";
import { EwsError } from "./client";

type DeviceOAuthConfig = Pick<EwsConfig, "auth" | "timeoutMs" | "maxResponseBytes">;

const oauthPost = async (
  url: string,
  values: Record<string, string>,
  config: DeviceOAuthConfig,
  options: EwsRuntimeOptions = {},
): Promise<{ status: number; data: Record<string, unknown> }> => {
  const fetcher =
    options.fetch ??
    createSafeFetch({
      blockPrivateResolution: true,
      ...options.safeFetchOptions,
      timeoutMs: config.timeoutMs ?? 30_000,
    });
  const response = await fetcher(url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    signal: options.safeFetchOptions?.signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new EwsError("OAuthRedirectRejected");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new EwsError("InvalidOAuthResponse");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      size += result.value.byteLength;
      if (size > Math.min(config.maxResponseBytes ?? 1_048_576, 1_048_576)) {
        throw new EwsError("OAuthResponseTooLarge");
      }
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid object");
    }
    return { status: response.status, data: data as Record<string, unknown> };
  } catch {
    throw new EwsError("InvalidOAuthResponse");
  }
};
const userAuth = (config: DeviceOAuthConfig): EwsUserAuth => {
  if (config.auth.type !== "oauth2-user") {
    throw new EwsError("UserOAuthRequired");
  }
  return config.auth;
};
const credentials = (auth: EwsUserAuth): Record<string, string> => ({
  client_id: auth.clientId,
  ...(auth.clientSecret && { client_secret: auth.clientSecret }),
});
const nonempty = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !/[\r\n]/u.test(value) &&
  !value.includes(String.fromCodePoint(0));
const applyUserTokens = (
  auth: EwsUserAuth,
  data: Record<string, unknown>,
): void => {
  if (
    !nonempty(data.access_token) ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    typeof data.token_type !== "string" ||
    data.token_type.toLowerCase() !== "bearer"
  ) {
    throw new EwsError("InvalidOAuthResponse");
  }
  if ("refresh_token" in data && !nonempty(data.refresh_token)) {
    throw new EwsError("InvalidOAuthResponse");
  }
  const refreshToken = data.refresh_token ?? auth.refreshToken;
  if (!nonempty(refreshToken)) {
    throw new EwsError("OfflineAccessRequired");
  }
  auth.refreshToken = refreshToken;
  auth.accessToken = data.access_token;
  auth.expiresAt = Date.now() + data.expires_in * 1000;
};
const getEwsUserAccessToken = async (
  config: DeviceOAuthConfig,
  options: EwsRuntimeOptions = {},
): Promise<string> => {
  const auth = userAuth(config);
  if (auth.accessToken && (auth.expiresAt ?? 0) > Date.now() + 60_000) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) {
    throw new EwsError("OAuthTokenRejected", 401);
  }
  const result = await oauthPost(
    auth.tokenUrl,
    {
      ...credentials(auth),
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
      scope: auth.scope,
    },
    config,
    options,
  );
  if (result.status !== 200) {
    throw new EwsError("OAuthTokenRejected", result.status);
  }
  applyUserTokens(auth, result.data);
  return auth.accessToken as string;
};
interface EwsDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}
const beginEwsDeviceAuthorization = async (
  config: DeviceOAuthConfig,
  options: EwsRuntimeOptions = {},
): Promise<EwsDeviceAuthorization> => {
  const auth = userAuth(config);
  const { status, data } = await oauthPost(
    auth.deviceAuthorizationUrl,
    { ...credentials(auth), scope: auth.scope },
    config,
    options,
  );
  if (status !== 200) {
    throw new EwsError("OAuthDeviceAuthorizationRejected", status);
  }
  if (
    !nonempty(data.device_code) ||
    !nonempty(data.user_code) ||
    !nonempty(data.verification_uri) ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new EwsError("InvalidOAuthResponse");
  }
  const uri = new URL(data.verification_uri);
  if (uri.protocol !== "https:" || uri.username || uri.password) {
    throw new EwsError("InvalidOAuthVerificationUrl");
  }
  const interval = data.interval ?? 5;
  if (
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval < 1 ||
    interval > 300
  ) {
    throw new EwsError("InvalidOAuthResponse");
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: uri.href,
    expiresAt: Date.now() + Math.min(data.expires_in, 1800) * 1000,
    interval,
  };
};
const pollEwsDeviceAuthorization = async (
  config: DeviceOAuthConfig,
  deviceCode: string,
  options: EwsRuntimeOptions = {},
): Promise<"authorized" | "authorization_pending" | "slow_down"> => {
  const auth = userAuth(config);
  const { status, data } = await oauthPost(
    auth.tokenUrl,
    {
      ...credentials(auth),
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    },
    config,
    options,
  );
  if (
    status === 400 &&
    (data.error === "authorization_pending" || data.error === "slow_down")
  ) {
    return data.error;
  }
  if (status !== 200) {
    throw new EwsError("OAuthDeviceAuthorizationRejected", status);
  }
  applyUserTokens(auth, data);
  return "authorized";
};
export {
  beginEwsDeviceAuthorization,
  pollEwsDeviceAuthorization,
  getEwsUserAccessToken,
};
export type { EwsDeviceAuthorization };
