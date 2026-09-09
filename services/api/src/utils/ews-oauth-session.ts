import { getEwsUserAccessToken, parseEwsConfig, type EwsConfig, type EwsRuntimeOptions } from "@keeper.sh/calendar/ews";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { createOAuthDeviceSessions, type OAuthDeviceSession } from "./oauth-device-session";
interface Session extends OAuthDeviceSession { config: EwsConfig; }
const sessions = createOAuthDeviceSessions<Session>("ews");
const startEwsSession = (userId: string, input: unknown) => {
  const config = parseEwsConfig(input);
  if (config.auth.type !== "oauth2-user" || !config.mailbox) {
    throw new Error("User authentication and mailbox required");
  }
  // Only the OAuth server may provide tokens. Never accept browser-supplied ones.
  delete config.auth.accessToken;
  delete config.auth.refreshToken;
  delete config.auth.expiresAt;
  return sessions.start(userId, { config });
};
const pollEwsSession = sessions.poll;
const resolveEwsRequest = async (
  userId: string,
  input: unknown,
): Promise<{ config: EwsConfig; runtime: EwsRuntimeOptions }> => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    {throw new Error("Invalid request");}
  const body = input as { config?: unknown; sessionId?: unknown };
  if ("sessionId" in body) {
    if (typeof body.sessionId !== "string") {
      throw new TypeError("Invalid session");
    }
    const id = body.sessionId;
    const session = await sessions.read(userId, id);
    if (!session.authorized) {
      throw new Error("Complete user authentication first");
    }
    const { config } = session;
    return {
      config,
      runtime: {
        safeFetchOptions,
        getAccessToken: () =>
          sessions.withSession(userId, id, async (current) => {
            if (!current.authorized) {
              throw new Error("Authentication required");
            }
            const token = await getEwsUserAccessToken(current.config, {
              safeFetchOptions,
            });
            config.auth = current.config.auth;
            return token;
          }),
      },
    };
  }
  const config = parseEwsConfig(body.config);
  if (config.auth.type === "oauth2-user") {
    throw new Error("Use the user sign-in flow");
  }
  return { config, runtime: { safeFetchOptions } };
};
const removeEwsSession = sessions.remove;
export { startEwsSession, pollEwsSession, resolveEwsRequest, removeEwsSession };
