import type { ReactNode, SubmitEvent } from "react";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import CalendarPlus from "lucide-react/dist/esm/icons/calendar-plus";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import KeeperLogo from "@/assets/keeper.svg?react";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Divider } from "@/components/ui/primitives/divider";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { providerIcons } from "@/lib/providers";
import { buildCalendarConsentUrl } from "@/lib/sign-up-continuation";

type Provider = "google" | "outlook";

interface ProviderPreamble {
  label: string;
  heading: string;
  company: string;
  accountNotice?: string;
}

const PROVIDER_PREAMBLES: Record<Provider, ProviderPreamble> = {
  google: { company: "Google", heading: "Google Calendar", label: "Google" },
  outlook: {
    accountNotice: "A work or school account may need your admin to approve Keeper.sh first.",
    company: "Microsoft",
    heading: "Outlook or Microsoft 365",
    label: "Outlook",
  },
};

const ACCESS_USES = [
  { icon: Eye, label: "Reads when your events happen" },
  { icon: CalendarPlus, label: "Adds busy blocks to calendars you pick" },
  { icon: ShieldCheck, label: "Never edits or deletes your events" },
  { icon: EyeOff, label: "Titles and guests stay private" },
];

const SOURCE_CODE_URL = "https://github.com/ridafkih/keeper.sh";

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
  const { label, heading, company, accountNotice } = PROVIDER_PREAMBLES[provider];
  return (
    <>
      <ProviderIconPair>
        <img
          src={providerIcons[provider]}
          alt={label}
          width={40}
          height={40}
          className="size-full rounded-lg p-3"
        />
      </ProviderIconPair>
      <div className="flex flex-col gap-1">
        <Heading2 as="h1">Connect {heading}</Heading2>
        <Text size="sm" tone="muted" align="left">
          {company} will ask for access to your calendars. This is what Keeper.sh does with it.
        </Text>
      </div>
      <NavigationMenu>
        {ACCESS_USES.map(({ icon: Icon, label: use }) => (
          <NavigationMenuItem key={use}>
            <NavigationMenuItemIcon>
              <Icon size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{use}</NavigationMenuItemLabel>
          </NavigationMenuItem>
        ))}
      </NavigationMenu>
      {accountNotice && (
        <Text size="sm" tone="muted" align="left">{accountNotice}</Text>
      )}
      <Divider />
      <form onSubmit={onSubmit} className="contents">
        <div className="flex items-stretch gap-2">
          <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
          <Button type="submit" className="grow justify-center">
            <ButtonText>Continue to {company}</ButtonText>
          </Button>
        </div>
      </form>
      <Text size="sm" tone="muted" align="center">
        Keeper.sh is open source.{" "}
        <ExternalTextLink href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
          Read the code
        </ExternalTextLink>
      </Text>
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
    track(ANALYTICS_EVENTS.oauth_authorize_started, { oauth_is_reconnect: false, provider_name: provider });
    window.location.href = buildCalendarConsentUrl(provider, { forSignedInAccount: false });
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
