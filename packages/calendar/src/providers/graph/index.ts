import type { EwsUserAuth } from "../ews/config";

interface GraphConnectionConfig {
  clientId: string;
  tenant: string;
  scope?: string;
}
const parseGraphConfig = (input: unknown): GraphConnectionConfig => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid Graph configuration");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.clientId !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value.clientId)) {
    throw new Error("A valid application Client ID is required");
  }
  const tenant = value.tenant ?? "common";
  if (typeof tenant !== "string" || !/^[a-z\d][a-z\d.-]{0,252}$/iu.test(tenant)) {
    throw new Error("Invalid tenant");
  }
  const { scope } = value;
  if ("scope" in value && (typeof scope !== "string" || !scope.trim() || scope.length > 4096 || /[^\u0020-\u007E]/u.test(scope))) {
    throw new Error("Invalid OAuth scopes");
  }
  if (typeof scope === "string") {
    return { clientId: value.clientId, tenant, scope: scope.trim().split(/ +/u).join(" ") };
  }
  return { clientId: value.clientId, tenant };
};
const graphDeviceConfig = (config: GraphConnectionConfig): { auth: EwsUserAuth } => ({
  auth: {
    type: "oauth2-user",
    clientId: config.clientId,
    tokenUrl: `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`,
    deviceAuthorizationUrl: `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/devicecode`,
    scope: config.scope ?? "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access",
  },
});
export { parseGraphConfig, graphDeviceConfig };
export type { GraphConnectionConfig };
