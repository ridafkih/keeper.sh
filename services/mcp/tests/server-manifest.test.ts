import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createKeeperMcpHandler } from "../src/mcp-handler";
import { createKeeperMcpToolset } from "../src/toolset";

/* The www host, which serves directly. The apex redirects, and a registry
   entry cannot be edited once published, so both the endpoint and the
   documentation URL have to sit on this origin. */
const CANONICAL_ORIGIN = "https://www.keeper.sh";

const REGISTRY_NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const REGISTRY_DESCRIPTION_MAX_LENGTH = 100;
const REGISTRY_TITLE_MAX_LENGTH = 100;
/* The registry schema caps `src` here, and an entry cannot be edited once
   published, so an over-long URL would have to be superseded by a version
   bump rather than fixed. */
const REGISTRY_ICON_SRC_MAX_LENGTH = 255;

/* Where an icon `src` on the canonical origin has to resolve from on disk. */
const PUBLIC_DIR = new URL("../../../applications/web/public/", import.meta.url);

/* Enough of the PNG container to assert what a file actually is, rather than
   trusting its name: the IHDR dimensions, and the palette entries that are
   fully opaque, which is what a viewer sees as the mark itself. */
const readPng = (file: URL) => {
  const bytes = readFileSync(file);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  let palette: Buffer | null = null;
  let transparency: Buffer = Buffer.alloc(0);
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "PLTE") {
      palette = data;
    }
    if (type === "tRNS") {
      transparency = data;
    }
    offset += 12 + length;
  }
  if (!palette) {
    throw new Error(`${file.pathname} is not a palette PNG`);
  }

  const opaqueLuminances: number[] = [];
  for (let entry = 0; entry < palette.length / 3; entry++) {
    /* Palette entries past the end of tRNS are fully opaque. */
    const alpha = transparency[entry] ?? 255;
    if (alpha === 255) {
      const channels = palette.subarray(entry * 3, entry * 3 + 3);
      const red = channels[0] ?? 0;
      const green = channels[1] ?? 0;
      const blue = channels[2] ?? 0;
      opaqueLuminances.push(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    }
  }

  return { width, height, opaqueLuminances };
};

const manifestSchema = z.object({
  $schema: z.string().url(),
  name: z.string().max(200).regex(REGISTRY_NAME_PATTERN),
  title: z.string().max(REGISTRY_TITLE_MAX_LENGTH),
  description: z.string().max(REGISTRY_DESCRIPTION_MAX_LENGTH),
  version: z.string(),
  websiteUrl: z.string().url(),
  repository: z.object({
    url: z.string().url(),
    source: z.literal("github"),
    subfolder: z.string(),
  }),
  icons: z.array(z.object({
    src: z.string().startsWith("https://").max(REGISTRY_ICON_SRC_MAX_LENGTH),
    mimeType: z.enum(["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"]),
    sizes: z.array(z.string().regex(/^\d+x\d+$|^any$/)),
    theme: z.enum(["light", "dark"]),
  })).min(1),
  remotes: z.array(z.object({
    type: z.literal("streamable-http"),
    url: z.string().url(),
  })).length(1),
});

const initializeResultSchema = z.object({
  result: z.object({
    serverInfo: z.object({
      name: z.string(),
      version: z.string(),
    }),
  }),
});

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("../../../server.json", import.meta.url), "utf8")),
);

const [namespace, serverSegment] = manifest.name.split("/");

const readAnnouncedServerInfo = async (): Promise<{ name: string; version: string }> => {
  const handler = createKeeperMcpHandler({
    auth: {
      api: {
        getMcpSession: () => Promise.resolve({
          scopes: "keeper.read",
          userId: "user-123",
        }),
      },
    },
    mcpPublicUrl: "https://mcp.keeper.sh",
    apiBaseUrl: "https://keeper.sh",
    toolset: createKeeperMcpToolset(),
  });

  const response = await handler(
    new Request("https://mcp.keeper.sh/mcp", {
      body: JSON.stringify({
        id: "1",
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
          protocolVersion: "2025-06-18",
        },
      }),
      headers: {
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );

  const { result } = initializeResultSchema.parse(await response.json());
  return result.serverInfo;
};

describe("registry manifest", () => {
  it("claims the namespace backed by the domain we can verify", () => {
    expect(namespace).toBe("sh.keeper");
  });

  it("advertises the hosted endpoint on the canonical host, which does not redirect", () => {
    expect(manifest.remotes[0]?.url).toBe(`${CANONICAL_ORIGIN}/mcp`);
  });

  it("documents itself on the canonical host", () => {
    expect(manifest.websiteUrl.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
  });

  it("serves every icon from the canonical origin, which consumers trust for this server", () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
    }
  });

  it("declares an icon for both a light and a dark background", () => {
    const themes = new Set(manifest.icons.map((icon) => icon.theme));
    expect(themes).toEqual(new Set(["light", "dark"]));
  });

  it("backs every declared icon with a file the web app actually serves", () => {
    for (const icon of manifest.icons) {
      const file = new URL(icon.src.slice(`${CANONICAL_ORIGIN}/`.length), PUBLIC_DIR);
      expect(existsSync(file), `${icon.src} has no file in applications/web/public`).toBe(true);
    }
  });

  it("declares the size each icon really is, not the size its name claims", () => {
    for (const icon of manifest.icons) {
      const file = new URL(icon.src.slice(`${CANONICAL_ORIGIN}/`.length), PUBLIC_DIR);
      const { width, height } = readPng(file);
      expect(icon.sizes, `${icon.src} is really ${width}x${height}`).toEqual([`${width}x${height}`]);
    }
  });

  /* The inversion this guards against is invisible until someone renders the
     icon on the wrong background: `theme: "light"` means the icon is designed
     to sit on a light background, so its mark has to be the dark one. */
  it("paints a dark mark for light backgrounds and a light mark for dark ones", () => {
    for (const icon of manifest.icons) {
      const file = new URL(icon.src.slice(`${CANONICAL_ORIGIN}/`.length), PUBLIC_DIR);
      const { opaqueLuminances } = readPng(file);
      expect(opaqueLuminances.length, `${icon.src} draws nothing opaque`).toBeGreaterThan(0);

      for (const luminance of opaqueLuminances) {
        if (icon.theme === "light") {
          expect(luminance, `${icon.src} is theme "light" but its mark is not dark`).toBeLessThan(64);
        } else {
          expect(luminance, `${icon.src} is theme "dark" but its mark is not light`).toBeGreaterThan(192);
        }
      }
    }
  });

  it("carries the name and version the server announces on initialize", async () => {
    const serverInfo = await readAnnouncedServerInfo();

    expect(serverInfo).toEqual({
      name: serverSegment,
      version: manifest.version,
    });
  });
});
