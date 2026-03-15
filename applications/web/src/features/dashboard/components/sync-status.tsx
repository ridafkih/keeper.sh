import { useAtomValue } from "jotai";
import { syncStateAtom, syncStatusLabelAtom, syncStatusShimmerAtom } from "../../../state/sync";
import { Text } from "../../../components/ui/primitives/text";
import { ShimmerText } from "../../../components/ui/primitives/shimmer-text";
import { Tooltip } from "../../../components/ui/primitives/tooltip";
import { clampPercent, resolveSyncPercent } from "./sync-status-helpers";

function SyncProgressCircle({ percent }: { percent: number }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = clampPercent(percent);
  const strokeDashoffset = circumference * (1 - clampedPercent / 100);

  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="-rotate-90 size-3.5 shrink-0">
      <circle
        cx={6}
        cy={6}
        r={radius}
        fill="none"
        strokeWidth={2}
        className="stroke-background-hover"
      />
      <circle
        cx={6}
        cy={6}
        r={radius}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        className="stroke-emerald-400 transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        style={{
          strokeDasharray: circumference,
          strokeDashoffset,
        }}
      />
    </svg>
  );
}

function SyncProgressIndicator() {
  const composite = useAtomValue(syncStateAtom);
  if (!composite.connected) {
    return <SyncProgressCircle percent={0} />;
  }

  const percent = resolveSyncPercent(composite);
  if (percent === null) {
    return null;
  }

  return <SyncProgressCircle percent={percent} />;
}

function SyncStatusLabel() {
  const label = useAtomValue(syncStatusLabelAtom);
  const isSyncing = useAtomValue(syncStatusShimmerAtom);

  if (isSyncing) {
    return <ShimmerText className="text-sm tracking-tight">{label}</ShimmerText>;
  }

  return <Text size="sm" tone="muted">{label}</Text>;
}

function SyncTooltipContent() {
  const composite = useAtomValue(syncStateAtom);
  if (!composite.connected) return null;
  const percent = resolveSyncPercent(composite);
  if (percent === null) return null;
  return <>{percent.toFixed(2)}%</>;
}

export function SyncStatus() {
  return (
    <Tooltip content={<SyncTooltipContent />}>
      <div className="self-start flex items-center gap-1.5 w-fit pb-2">
        <SyncStatusLabel />
        <SyncProgressIndicator />
      </div>
    </Tooltip>
  );
}
