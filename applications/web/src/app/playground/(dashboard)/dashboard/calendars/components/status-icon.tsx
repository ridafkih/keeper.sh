import type { FC } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";

interface StatusIconProps {
  status: "synced" | "syncing" | "error" | "reauthenticate";
}

export const StatusIcon: FC<StatusIconProps> = ({ status }) => {
  if (status === "syncing") {
    return <RefreshCw size={14} className="text-foreground-subtle animate-spin" />;
  }
  if (status === "synced") {
    return <Check size={14} className="text-foreground-subtle" />;
  }
  if (status === "reauthenticate") {
    return <AlertTriangle size={14} className="text-amber-400" />;
  }
  return <div className="size-1 rounded-xl bg-red-500" />;
};
