const R = 12;
const PATH_UPPER = `M -10,20 L ${210 - R},20 Q 210,20 210,${20 + R} L 210,${50 - R} Q 210,50 ${210 + R},50 L 310,50`;
const PATH_LOWER = `M -10,80 L ${210 - R},80 Q 210,80 210,${80 - R} L 210,${50 + R} Q 210,50 ${210 + R},50 L 310,50`;

const ICON_SIZE = 24;

const PROVIDERS = [
  { icon: "/integrations/icon-google-calendar.svg", x: 100, y: 20 },
  { icon: "/integrations/icon-outlook.svg", x: 100, y: 80 },
  { icon: "/integrations/icon-icloud.svg", x: 260, y: 50 },
];

export function MarketingIllustrationSync() {
  return (
    <div className="w-full flex items-center justify-center">
      <svg
        viewBox="0 0 300 100"
        className="w-full"
        role="presentation"
        aria-hidden="true"
      >
        <path
          d={PATH_UPPER}
          fill="none"
          className="stroke-foreground-disabled"
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="7"
            to="0"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
        <path
          d={PATH_LOWER}
          fill="none"
          className="stroke-foreground-disabled"
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="7"
            to="0"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>

        {PROVIDERS.map(({ icon, x, y }) => (
          <image
            key={icon}
            href={icon}
            x={x - ICON_SIZE / 2}
            y={y - ICON_SIZE / 2}
            width={ICON_SIZE}
            height={ICON_SIZE}
          />
        ))}
      </svg>
    </div>
  );
}
