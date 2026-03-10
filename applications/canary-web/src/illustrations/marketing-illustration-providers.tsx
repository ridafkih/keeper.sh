import { providerIcons } from "../lib/providers";

const ORBIT_ITEMS = Object.entries(providerIcons).reverse();
const ORBIT_DURATION = 12;
const RADIUS = 110;
const ICON_SIZE = 32;

export function MarketingIllustrationProviders() {
  return (
    <div className="relative w-full overflow-hidden px-4" style={{ height: 120 }}>
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ width: 220, height: 220, top: 40 }}
      >
        <div
          className="relative w-full h-full"
          style={{ animation: `spin ${ORBIT_DURATION}s linear infinite` }}
        >
          {ORBIT_ITEMS.map(([provider, iconPath], index) => {
            const angle = (360 / ORBIT_ITEMS.length) * index;
            const radians = (angle * Math.PI) / 180;
            const posX = Math.cos(radians) * RADIUS;
            const posY = Math.sin(radians) * RADIUS;

            return (
              <div
                key={provider}
                className="absolute left-1/2 top-1/2"
                style={{ transform: `translate(${posX}px, ${posY}px)` }}
              >
                <div
                  className="-translate-x-1/2 -translate-y-1/2"
                  style={{ animation: `counter-spin ${ORBIT_DURATION}s linear infinite` }}
                >
                  <img
                    src={iconPath}
                    alt=""
                    width={ICON_SIZE}
                    height={ICON_SIZE}
                    style={{ width: ICON_SIZE, height: ICON_SIZE }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background to-transparent pointer-events-none" />
    </div>
  );
}
