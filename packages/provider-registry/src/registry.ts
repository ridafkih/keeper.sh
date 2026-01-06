import type { AuthType, ProviderDefinition } from "@keeper.sh/provider-core";

const googleCalendarDefinition = {
  authType: "oauth",
  icon: "/integrations/icon-google.svg",
  id: "google",
  name: "Google Calendar",
} as const satisfies ProviderDefinition;

const outlookDefinition = {
  authType: "oauth",
  icon: "/integrations/icon-outlook.svg",
  id: "outlook",
  name: "Outlook",
} as const satisfies ProviderDefinition;

const caldavDefinition = {
  authType: "caldav",
  caldav: {
    passwordHelp: "Your CalDAV password or app password",
    passwordLabel: "Password",
    serverUrl: "",
    usernameHelp: "Your CalDAV username",
    usernameLabel: "Username",
  },
  id: "caldav",
  name: "CalDAV",
} as const satisfies ProviderDefinition;

const fastmailDefinition = {
  authType: "caldav",
  caldav: {
    passwordHelp: "Generate one at Settings → Password & Security → Third-party apps",
    passwordLabel: "App Password",
    serverUrl: "https://caldav.fastmail.com/",
    usernameHelp: "Your FastMail email address",
    usernameLabel: "Email",
  },
  icon: "/integrations/icon-fastmail.svg",
  id: "fastmail",
  name: "FastMail",
} as const satisfies ProviderDefinition;

const icloudDefinition = {
  authType: "caldav",
  caldav: {
    passwordHelp: "Generate one at appleid.apple.com → Sign-In and Security",
    passwordLabel: "App-Specific Password",
    serverUrl: "https://caldav.icloud.com/",
    usernameHelp: "Your Apple ID email address",
    usernameLabel: "Apple ID",
  },
  icon: "/integrations/icon-icloud.svg",
  id: "icloud",
  name: "iCloud",
} as const satisfies ProviderDefinition;

const PROVIDER_DEFINITIONS = [
  googleCalendarDefinition,
  outlookDefinition,
  fastmailDefinition,
  icloudDefinition,
  caldavDefinition,
] as const;

type ProviderId = (typeof PROVIDER_DEFINITIONS)[number]["id"];

type OAuthProviderDefinition = Extract<
  (typeof PROVIDER_DEFINITIONS)[number],
  { authType: "oauth" }
>;

type CalDAVProviderDefinition = Extract<
  (typeof PROVIDER_DEFINITIONS)[number],
  { authType: "caldav" }
>;

type OAuthProviderId = OAuthProviderDefinition["id"];
type CalDAVProviderId = CalDAVProviderDefinition["id"];

const getProvider = (id: string): ProviderDefinition | undefined =>
  PROVIDER_DEFINITIONS.find((provider) => provider.id === id);

const getProvidersByAuthType = (authType: AuthType): ProviderDefinition[] =>
  PROVIDER_DEFINITIONS.filter((provider) => provider.authType === authType);

const getOAuthProviders = (): OAuthProviderDefinition[] =>
  PROVIDER_DEFINITIONS.filter((provider): provider is OAuthProviderDefinition => provider.authType === "oauth");

const getCalDAVProviders = (): CalDAVProviderDefinition[] =>
  PROVIDER_DEFINITIONS.filter((provider): provider is CalDAVProviderDefinition => provider.authType === "caldav");

const isCalDAVProvider = (id: string): id is CalDAVProviderId => {
  const provider = getProvider(id);
  return provider?.authType === "caldav";
};

const isOAuthProvider = (id: string): id is OAuthProviderId => {
  const provider = getProvider(id);
  return provider?.authType === "oauth";
};

const getActiveProviders = (): ProviderDefinition[] =>
  PROVIDER_DEFINITIONS.filter((provider) => !("comingSoon" in provider && provider.comingSoon));

const isProviderId = (id: string): id is ProviderId =>
  PROVIDER_DEFINITIONS.some((provider) => provider.id === id);

export {
  PROVIDER_DEFINITIONS,
  getProvider,
  getProvidersByAuthType,
  getOAuthProviders,
  getCalDAVProviders,
  isCalDAVProvider,
  isOAuthProvider,
  isProviderId,
  getActiveProviders,
};
export type { ProviderId, OAuthProviderId, CalDAVProviderId, OAuthProviderDefinition, CalDAVProviderDefinition };
