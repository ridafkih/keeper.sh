import type { ReactNode, SubmitEvent } from "react";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import KeeperLogo from "@/assets/keeper.svg?react";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Divider } from "@/components/ui/primitives/divider";
import { Button, ButtonText } from "@/components/ui/primitives/button";

type Provider = "google" | "outlook";

interface ProviderPreamble {
  label: string;
  accountNotice?: string;
}

const PROVIDER_PREAMBLES: Record<Provider, ProviderPreamble> = {
  google: { label: "Google" },
  outlook: {
    label: "Outlook",
    accountNotice:
      "Works with personal Outlook and work or school Microsoft 365 accounts. A work or school account may need your admin to approve Keeper.sh first.",
  },
};

const PERMISSIONS = [
  "See your email address",
  "View a list of your calendars",
  "View events, summaries and details",
  "Add or remove calendar events",
];

export function PermissionsList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item} className="flex flex-row-reverse justify-between items-center gap-2">
          <Check className="shrink-0 text-foreground-muted" size={16} />
          <Text size="sm" tone="muted" align="left">{item}</Text>
        </li>
      ))}
    </ul>
  );
}

interface PreambleLayoutProps {
  provider: Provider;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  children?: ReactNode;
}

function PreambleLayout({ provider, onSubmit, children }: PreambleLayoutProps) {
  const { label, accountNotice } = PROVIDER_PREAMBLES[provider];
  return (
    <>
      <ProviderIconPair>
        <img
          src={`/integrations/icon-${provider}.svg`}
          alt={label}
          width={40}
          height={40}
          className="size-full rounded-lg p-3"
        />
      </ProviderIconPair>
      <Heading2 as="h1">Connect {label}</Heading2>
      <Text size="sm" tone="muted" align="left">
        Keeper.sh reads your events so it can show you as busy on your other calendars.
      </Text>
      <PermissionsList items={PERMISSIONS} />
      <Text size="sm" tone="muted" align="left">
        Edit access lets Keeper.sh add its own copies to the calendars you sync to. It never edits or deletes your own events, and titles, descriptions, locations and guests stay behind by default.
      </Text>
      {accountNotice && (
        <Text size="sm" tone="muted" align="left">{accountNotice}</Text>
      )}
      <Divider />
      <form onSubmit={onSubmit} className="contents">
        <div className="flex items-stretch gap-2">
          <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
          <Button type="submit" className="grow justify-center">
            <ButtonText>Connect</ButtonText>
          </Button>
        </div>
      </form>
      {children}
    </>
  );
}

interface LinkOAuthPreambleProps {
  provider: Provider;
}

export function LinkOAuthPreamble({ provider }: LinkOAuthPreambleProps) {
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.location.href = `/api/sources/authorize?provider=${provider}`;
  };

  return (
    <PreambleLayout provider={provider} onSubmit={handleSubmit} />
  );
}

export function ProviderIconPair({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-4 pb-4">
      <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-3 flex items-center justify-center bg-background-inverse">
        <KeeperLogo className="size-full rounded-lg text-foreground-inverse p-1" />
      </div>
      <ArrowLeftRight size={20} className="text-foreground-muted" />
      <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-1 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
