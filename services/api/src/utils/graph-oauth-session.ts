import { getEwsUserAccessToken } from "@keeper.sh/calendar/ews";
import { parseGraphConfig, graphDeviceConfig, type GraphConnectionConfig } from "@keeper.sh/calendar/graph";
import { safeFetchOptions } from "@/utils/safe-fetch-options";
import { createOAuthDeviceSessions, type OAuthDeviceSession } from "./oauth-device-session";
interface Session extends OAuthDeviceSession {
  config: ReturnType<typeof graphDeviceConfig>;
  connection: GraphConnectionConfig;
}
const sessions = createOAuthDeviceSessions<Session>("graph");
const startGraphSession = (userId: string, input: unknown) => {
  const connection = parseGraphConfig(input);
  return sessions.start(userId, { config: graphDeviceConfig(connection), connection });
};
const pollGraphSession = sessions.poll;
const withAuthorizedGraphSession = <Result>(
  userId: string, id: string, action: (session: Session) => Promise<Result>,
) => sessions.withSession(userId, id, async (session) => {
  if (!session.authorized) { throw new Error("Complete Microsoft sign-in first"); }
  await getEwsUserAccessToken(session.config, { safeFetchOptions });
  return action(session);
});
const removeGraphSession = sessions.remove;
export { startGraphSession, pollGraphSession, withAuthorizedGraphSession, removeGraphSession };
