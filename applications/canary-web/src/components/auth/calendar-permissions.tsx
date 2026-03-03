import type { PropsWithChildren, SubmitEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowLeftRight, Check } from "lucide-react";
import KeeperLogo from "../../assets/keeper.svg?react";
import { Text } from "../ui/text";
import { Divider } from "../ui/divider";
import { Button, LinkButton, ButtonIcon } from "../ui/button";

type Provider = "google" | "outlook";

const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google",
  outlook: "Outlook",
};

function Card({ children }: PropsWithChildren) {
  return (
    <div className="p-2 border border-interactive-border rounded-3xl shadow-xs">
      <div className="flex flex-col border border-interactive-border rounded-2xl p-3 pt-8 shadow-xs">
        {children}
      </div>
    </div>
  );
}

function Header({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-6 px-2">
      {children}
    </div>
  );
}

function IconPair({ provider }: { provider: Provider }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-3 flex items-center justify-center bg-background-inverse">
        <KeeperLogo className="size-full rounded-lg text-foreground-inverse" />
      </div>
      <ArrowLeftRight size={20} className="text-foreground-muted" />
      <div className="size-14 rounded-xl border border-interactive-border shadow-xs p-1 flex items-center justify-center">
        <img
          src={`/integrations/icon-${provider}.svg`}
          alt={PROVIDER_LABELS[provider]}
          width={40}
          height={40}
          className="size-full rounded-lg p-3"
        />
      </div>
    </div>
  );
}

function Content({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-2">
      {children}
    </div>
  );
}

function PermissionsList({ children }: PropsWithChildren) {
  return (
    <div className="px-2 py-4">
      <ul className="flex flex-col gap-1">
        {children}
      </ul>
    </div>
  );
}

function PermissionsItem({ children }: PropsWithChildren) {
  return (
    <li className="flex flex-row-reverse justify-between items-center gap-2">
      <Check className="shrink-0 text-foreground-muted" size={16} />
      <Text size="sm" tone="muted" align="left">{children}</Text>
    </li>
  );
}

function Actions({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-3">
      <Divider />
      {children}
    </div>
  );
}

function ConnectForm({ backHref }: { backHref: string }) {
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <form onSubmit={handleSubmit} className="contents">
      <div className="flex items-stretch">
        <LinkButton to={backHref} variant="border" className="self-stretch justify-center mr-2 px-3.5">
          <ButtonIcon>
            <ArrowLeft size={16} />
          </ButtonIcon>
        </LinkButton>
        <Button type="submit" className="grow justify-center">
          Connect
        </Button>
      </div>
    </form>
  );
}

function SkipLink({ href, children }: PropsWithChildren<{ href: string }>) {
  return (
    <Link to={href} className="text-center pt-2 opacity-80 hover:opacity-100 underline underline-offset-2">
      <Text size="sm" tone="muted">{children}</Text>
    </Link>
  );
}

export {
  Card as PermissionsCard,
  Header as PermissionsHeader,
  IconPair as PermissionsIconPair,
  Content as PermissionsContent,
  PermissionsList,
  PermissionsItem,
  Actions as PermissionsActions,
  ConnectForm as PermissionsConnectForm,
  SkipLink as PermissionsSkipLink,
};
