import type { ConnectProvider } from "@/lib/connect-providers";
import type { CalendarSource } from "@/types/api";

export interface ConnectedAccount {
  accountId: string;
  label: string;
  provider: string;
  calendarNames: string[];
}

// The ids a source reports for an account made through each connect option.
const SOURCE_PROVIDERS: Record<string, string[]> = {
  apple: ["icloud"],
  caldav: ["caldav", "nextcloud", "radicale"],
  fastmail: ["fastmail"],
  google: ["google"],
  "ical-link": ["ics"],
  microsoft: ["microsoft-365"],
  outlook: ["outlook"],
};

const ANOTHER_LABELS: Record<string, string> = {
  apple: "Connect Another iCloud Account",
  caldav: "Connect Another CalDAV Server",
  fastmail: "Connect Another Fastmail Account",
  google: "Connect Another Google Account",
  "ical-link": "Subscribe to Another ICS Feed",
  microsoft: "Connect Another Microsoft 365 Account",
  outlook: "Connect Another Outlook Account",
};

export const groupConnectedAccounts = (sources: readonly CalendarSource[]): ConnectedAccount[] => {
  const accounts = new Map<string, ConnectedAccount>();
  for (const source of sources) {
    const account = accounts.get(source.accountId) ?? {
      accountId: source.accountId,
      calendarNames: [],
      label: source.email ?? source.accountLabel,
      provider: source.provider,
    };
    account.calendarNames.push(source.name);
    accounts.set(source.accountId, account);
  }
  return [...accounts.values()];
};

export const connectLabel = (provider: ConnectProvider, accounts: readonly ConnectedAccount[]): string => {
  const providers = SOURCE_PROVIDERS[provider.id] ?? [];
  const connected = accounts.some((account) => providers.includes(account.provider));
  if (!connected) return provider.label;
  return ANOTHER_LABELS[provider.id] ?? provider.label;
};

// A sync needs somewhere to write, so at least one of the two calendars has to accept copies.
export const canStartFirstSync = (sources: readonly CalendarSource[]): boolean =>
  sources.length >= 2 && sources.some((source) => source.capabilities.includes("push"));
