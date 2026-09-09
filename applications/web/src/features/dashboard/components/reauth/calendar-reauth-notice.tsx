import { Link } from "@tanstack/react-router";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { Text } from "@/components/ui/primitives/text";
import { pluralize } from "@/lib/pluralize";
import { reauthHref, useReauthAccounts } from "./use-reauth-accounts";

/** Sits between the calendar toolbar and the day row, as part of the frame's chrome. */
export function CalendarReauthStrip() {
  const accounts = useReauthAccounts();
  if (accounts.length === 0) return null;

  return (
    <Link
      to={accounts.length === 1 ? reauthHref(accounts[0]) : "/dashboard"}
      className="flex items-center gap-2.5 border-y border-attention-border bg-attention-background px-4 py-2.5 hover:bg-attention-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TriangleAlert size={15} className="shrink-0 text-attention" />
      <Text size="sm" tone="muted" className="min-w-0 truncate">
        <span className="font-medium text-foreground">
          {pluralize(accounts.length, "calendar account")}
        </span>{" "}
        {accounts.length === 1 ? "needs" : "need"} your attention.
      </Text>
      <div className="flex grow items-center justify-end gap-1">
        <Text as="span" size="sm" tone="attention" className="hidden sm:block">
          Reconnect
        </Text>
        <ArrowRight size={15} className="shrink-0 text-attention" />
      </div>
    </Link>
  );
}
