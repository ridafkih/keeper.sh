const SCREENSHOT_WIDTH = 832;
const SCREENSHOT_HEIGHT = 868;

const SCREENSHOT_ALT =
  "The Keeper.sh dashboard, showing a sync status of Up to Date, a bar chart of events synced across the surrounding two weeks, and menu entries for importing calendars, browsing events and managing iCal feeds.";

export function MarketingHeroScreenshot() {
  return (
    <div className="w-full max-w-[26rem] mx-auto pt-6 px-2">
      <picture>
        <source srcSet="/product/dashboard-dark.png" media="(prefers-color-scheme: dark)" />
        <img
          src="/product/dashboard-light.png"
          alt={SCREENSHOT_ALT}
          width={SCREENSHOT_WIDTH}
          height={SCREENSHOT_HEIGHT}
          className="w-full h-auto rounded-2xl border border-interactive-border"
        />
      </picture>
    </div>
  );
}
