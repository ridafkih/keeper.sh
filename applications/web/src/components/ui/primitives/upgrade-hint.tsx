import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { tv } from "tailwind-variants/lite";
import { getCommercialMode } from "@/config/commercial";
import { useEntitlements } from "@/hooks/use-entitlements";
import { Text } from "./text";

type UserAccessState = "subscribed" | "trial" | "expired";

function useAccessState(): UserAccessState {
  const { data: entitlements } = useEntitlements();

  if (entitlements?.plan === "pro" || entitlements?.plan === "unlimited") {
    if (entitlements?.trial) {
      return "trial";
    }
    return "subscribed";
  }

  return "expired";
}

function UpgradeLink({ children }: PropsWithChildren) {
  return (
    <Link to="/dashboard/upgrade" className="underline underline-offset-2">
      {children}
    </Link>
  );
}

function resolveHintMessage(accessState: UserAccessState, hint: string): string {
  if (accessState === "trial") {
    return "Subscribe to keep using this feature.";
  }
  if (accessState === "expired") {
    return "Subscribe to unlock this feature.";
  }
  return hint;
}

function UpgradeCallToAction({ hint }: { hint?: string }) {
  const accessState = useAccessState();
  const message = hint ? resolveHintMessage(accessState, hint) : undefined;

  return (
    <Text size="sm" tone="muted" align="center">
      {message ? `${message} ` : ""}<UpgradeLink>Upgrade</UpgradeLink>
    </Text>
  );
}

function UpgradeHint({ children }: PropsWithChildren) {
  const accessState = useAccessState();

  if (!getCommercialMode()) return null;

  const message = resolveHintMessage(accessState, children as string);

  return (
    <Text size="sm" tone="muted" className="px-0.5">
      {message}{" "}
      <UpgradeLink>Upgrade</UpgradeLink>
    </Text>
  );
}

const premiumFeatureGateStyle = tv({
  base: "-mx-1 p-0.75 pb-1.5 rounded-[1.25rem] flex flex-col gap-1 relative overflow-hidden border",
  variants: {
    tone: {
      default: "border-border-elevated bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_8px)] dark:bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(255,255,255,0.03)_4px,rgba(255,255,255,0.03)_8px)]",
      blue: "border-blue-300 dark:border-blue-800 bg-[repeating-linear-gradient(135deg,var(--color-blue-50),var(--color-blue-50)_4px,var(--color-blue-100)_4px,var(--color-blue-100)_8px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-blue-950),var(--color-blue-950)_4px,var(--color-blue-900)_4px,var(--color-blue-900)_8px)]",
      emerald: "border-emerald-200 dark:border-emerald-800 bg-[repeating-linear-gradient(135deg,var(--color-emerald-50),var(--color-emerald-50)_4px,var(--color-emerald-100)_4px,var(--color-emerald-100)_8px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-emerald-950),var(--color-emerald-950)_4px,var(--color-emerald-900)_4px,var(--color-emerald-900)_8px)]",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

interface PremiumFeatureGateProps {
  locked: boolean;
  children: ReactNode;
  hint?: string;
  footer?: ReactNode;
  interactive?: boolean;
  tone?: "default" | "blue" | "emerald";
}

function PremiumFeatureGate({ locked, children, hint, footer, interactive = false, tone = "default" }: PremiumFeatureGateProps) {
  if (!locked || !getCommercialMode()) return <>{children}</>;

  return (
    <div className={premiumFeatureGateStyle({ tone })}>
      <div className={interactive ? "flex flex-col gap-1" : "pointer-events-none flex flex-col gap-1"} aria-disabled={!interactive}>
        {children}
      </div>
      {footer ? footer : <UpgradeCallToAction hint={hint} />}
    </div>
  );
}

export { UpgradeHint, PremiumFeatureGate };
