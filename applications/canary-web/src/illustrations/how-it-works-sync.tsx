const CIRCLE_RADIUS = 14;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

export function HowItWorksSync() {
  return (
    <div className="flex items-center gap-2.5">
      <svg aria-hidden="true" viewBox="0 0 36 36" className="-rotate-90 size-6 shrink-0">
        <circle
          cx={18}
          cy={18}
          r={CIRCLE_RADIUS}
          fill="none"
          strokeWidth={3}
          className="stroke-background-hover"
        />
        <circle
          cx={18}
          cy={18}
          r={CIRCLE_RADIUS}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          className="stroke-emerald-400"
          style={{
            strokeDasharray: CIRCLE_CIRCUMFERENCE,
            animation: "sync-progress 3s ease-in-out infinite",
          }}
        />
      </svg>
      <span className="text-sm tracking-tight text-foreground">Syncing…</span>
    </div>
  );
}
