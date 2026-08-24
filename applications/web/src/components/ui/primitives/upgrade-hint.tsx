import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { getCommercialMode } from "@/config/commercial";
import { Text } from "./text";

function UpgradeHint({ children }: PropsWithChildren) {
  if (!getCommercialMode()) return null;

  return (
    <Text size="sm" tone="muted" className="px-0.5">
      {children}{" "}
      <Link to="/dashboard/upgrade" className="underline underline-offset-2">
        Upgrade to Pro
      </Link>
    </Text>
  );
}

function PremiumFeatureGate({ locked, children, hint }: { locked: boolean; children: ReactNode; hint: string }) {
  if (!locked || !getCommercialMode()) return <>{children}</>;

  return (
    <div
      className="-mx-1 p-1 rounded-[1.25rem] flex flex-col gap-1 relative overflow-hidden border border-border-elevated bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_8px)]"
    >
      <div className="pointer-events-none" aria-disabled="true">
        {children}
      </div>
      <Text size="sm" tone="muted" align="center">
        {hint}{" "}
        <Link to="/dashboard/upgrade" className="underline underline-offset-2">
          Upgrade to Pro
        </Link>
      </Text>
    </div>
  );
}

export { UpgradeHint, PremiumFeatureGate };
