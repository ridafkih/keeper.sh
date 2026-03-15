import type { ReactNode, SubmitEvent } from "react";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import KeeperLogo from "@/assets/keeper.svg?react";
import { authClient } from "@/lib/auth-client";
import {
  resolvePathWithSearch,
  resolveClientPostAuthRedirect,
  type StringSearchParams,
} from "@/lib/mcp-auth-flow";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { Divider } from "@/components/ui/primitives/divider";
import { Button, ButtonText } from "@/components/ui/primitives/button";

type Provider = "google" | "outlook" | "microsoft-365";

const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google",
  outlook: "Outlook",
  "microsoft-365": "Microsoft 365",
};

const PERMISSIONS = [
  "See your email address",
  "View a list of your calendars",
  "View events, summaries and details",
  "Add or remove calendar events",
];

const PROVIDER_SOCIAL_MAP: Partial<Record<Provider, string>> = {
  google: "google",
  outlook: "microsoft",
};

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
  return (
    <>
      <ProviderIconPair>
        <img
          src={`/integrations/icon-${provider}.svg`}
          alt={PROVIDER_LABELS[provider]}
          width={40}
          height={40}
          className="size-full rounded-lg p-3"
        />
      </ProviderIconPair>
      <Heading2 as="h1">Connect {PROVIDER_LABELS[provider]}</Heading2>
      <Text size="sm" tone="muted" align="left">
        Start importing your events and sync them across all your calendars.
      </Text>
      <PermissionsList items={PERMISSIONS} />
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

interface AuthOAuthPreambleProps {
  provider: Provider;
  authorizationSearch?: StringSearchParams;
}

export function AuthOAuthPreamble({
  provider,
  authorizationSearch,
}: AuthOAuthPreambleProps) {
  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const socialProvider = PROVIDER_SOCIAL_MAP[provider];
    if (!socialProvider) return;

    await authClient.signIn.social({
      callbackURL: resolveClientPostAuthRedirect(authorizationSearch),
      provider: socialProvider,
    });
  };

  return (
    <PreambleLayout provider={provider} onSubmit={handleSubmit}>
      <ExternalTextLink href={resolvePathWithSearch("/login", authorizationSearch)}>
        Don&apos;t import my calendars yet, just log me in.
      </ExternalTextLink>
    </PreambleLayout>
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
