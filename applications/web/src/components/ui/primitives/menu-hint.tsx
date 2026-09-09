import type { CSSProperties, ComponentPropsWithoutRef, PropsWithChildren, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { getCommercialMode } from "@/config/commercial";
import { Text } from "./text";

type GateTone = "muted" | "attention";

interface GateAction {
  label: string;
  to: string;
  /** Rendered after the link, so a sentence can close on punctuation without underlining it. */
  trailing?: string;
}

const UPGRADE_ACTION: GateAction = { label: "Upgrade to Pro", to: "/dashboard/upgrade" };

const GATE_CLASS: Record<GateTone, string> = {
  muted: "-mx-1 flex flex-col gap-1 rounded-[1.25rem] border border-border-elevated p-1",
  attention:
    "-mx-1 flex flex-col gap-1 rounded-[1.25rem] border border-attention-border p-1 attention-hatch",
};

/** The premium gate's caption stays muted; the attention gate's reads at full foreground. */
const CAPTION_TONE: Record<GateTone, "muted" | "default"> = {
  muted: "muted",
  attention: "default",
};

const STRIPE_STYLE: Record<GateTone, CSSProperties> = {
  muted: {
    backgroundImage:
      "repeating-linear-gradient(135deg,transparent,transparent 4px,rgba(0,0,0,0.03) 4px,rgba(0,0,0,0.03) 8px)",
  },
  // Painted by the `attention-hatch` utility instead, so one definition serves every surface.
  attention: {},
};

interface MenuHintProps {
  tone?: ComponentPropsWithoutRef<typeof Text>["tone"];
  action?: GateAction;
  align?: "left" | "center";
  className?: string;
}

/** The line of explanatory text that sits under a menu, optionally ending in a link. */
function MenuHint({
  tone = "muted",
  action,
  align = "left",
  className,
  children,
}: PropsWithChildren<MenuHintProps>) {
  return (
    <Text
      size="sm"
      tone={tone}
      align={align}
      className={className ?? (align === "left" ? "px-0.5" : undefined)}
    >
      {children}
      {action && (
        <>
          {" "}
          <Link to={action.to} className="underline underline-offset-2">
            {action.label}
          </Link>
          {action.trailing}
        </>
      )}
    </Text>
  );
}

interface MenuGateProps {
  active: boolean;
  tone?: GateTone;
  hint: string;
  action?: GateAction;
  /** Locked gates disable what they wrap; an advisory gate leaves it usable. */
  disableChildren?: boolean;
  children: ReactNode;
}

/** Wraps a menu in hatching and an explanatory line, for a feature the reader cannot use yet. */
function MenuGate({
  active,
  tone = "muted",
  hint,
  action,
  disableChildren = false,
  children,
}: MenuGateProps) {
  if (!active) return <>{children}</>;

  return (
    <div className={GATE_CLASS[tone]} style={STRIPE_STYLE[tone]}>
      {disableChildren ? (
        <div className="pointer-events-none" aria-disabled="true">
          {children}
        </div>
      ) : (
        children
      )}
      <MenuHint
        tone={CAPTION_TONE[tone]}
        action={action}
        align="center"
        className="px-4 sm:px-3.5"
      >
        {hint}
      </MenuHint>
    </div>
  );
}

function PremiumHint({ children }: PropsWithChildren) {
  if (!getCommercialMode()) return null;

  return <MenuHint action={UPGRADE_ACTION}>{children}</MenuHint>;
}

function PremiumGate({
  locked,
  children,
  hint,
}: {
  locked: boolean;
  children: ReactNode;
  hint: string;
}) {
  return (
    <MenuGate
      active={locked && getCommercialMode()}
      hint={hint}
      action={UPGRADE_ACTION}
      disableChildren
    >
      {children}
    </MenuGate>
  );
}

export { MenuHint, MenuGate, PremiumHint, PremiumGate };
