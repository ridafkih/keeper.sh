import type { Implementation } from "@modelcontextprotocol/sdk/types.js";

const ICON_ORIGIN = "https://www.keeper.sh";
const ICON_SIZES = [48, 96, 192, 512] as const;
const ICON_THEMES = ["light", "dark"] as const;

const KEEPER_MCP_ICONS: NonNullable<Implementation["icons"]> = ICON_THEMES.flatMap((theme) =>
  ICON_SIZES.map((size) => ({
    src: `${ICON_ORIGIN}/${size}x${size}-on-${theme}.png`,
    mimeType: "image/png",
    sizes: [`${size}x${size}`],
    theme,
  })),
);

const KEEPER_MCP_SERVER_INFO: Implementation = {
  name: "keeper-sh",
  title: "Keeper.sh",
  version: "1.0.1",
  websiteUrl: "https://www.keeper.sh/docs/mcp",
  icons: KEEPER_MCP_ICONS,
};

export { KEEPER_MCP_SERVER_INFO };
