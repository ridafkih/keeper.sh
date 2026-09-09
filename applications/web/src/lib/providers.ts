export const providerIcons: Record<string, string> = {
  google: "/integrations/icon-google-calendar.svg",
  outlook: "/integrations/icon-outlook.svg",
  icloud: "/integrations/icon-icloud.svg",
  fastmail: "/integrations/icon-fastmail.svg",
  "microsoft-365": "/integrations/icon-microsoft-365.svg",
  nextcloud: "/integrations/icon-nextcloud.svg",
  radicale: "/integrations/icon-radicale.svg",
};

/** Where a provider's app-specific password is issued, for CalDAV accounts that cannot refresh. */
const providerAppPasswordUrls: Record<string, string> = {
  icloud: "https://support.apple.com/102654",
  fastmail: "https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords",
};

export function providerAppPasswordUrl(provider: string): string | null {
  return providerAppPasswordUrls[provider] ?? null;
}

/** The `provider` value `/api/sources/authorize` expects, which is not always the account's. */
const providerAuthorizeIds: Record<string, string> = {
  google: "google",
  outlook: "outlook",
  "microsoft-365": "outlook",
};

export function providerAuthorizeId(provider: string): string | null {
  return providerAuthorizeIds[provider] ?? null;
}
