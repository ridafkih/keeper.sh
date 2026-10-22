import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from "vitest";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { createSafeFetch, UrlSafetyError } from "../../src/utils/safe-fetch";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const ICS_BODY = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Encoded\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

const ENCODED_BODIES: Record<string, Uint8Array> = {
  br: brotliCompressSync(ICS_BODY),
  deflate: deflateSync(ICS_BODY),
  gzip: gzipSync(ICS_BODY),
};

const server = Bun.serve({
  fetch: (request) => {
    const encoding = new URL(request.url).pathname.slice(1);
    return new Response(ENCODED_BODIES[encoding], {
      headers: {
        "content-encoding": encoding,
        "x-accept-encoding": request.headers.get("accept-encoding") ?? "",
      },
    });
  },
  port: 0,
});

const urlFor = (encoding: string): string => `http://127.0.0.1:${server.port}/${encoding}`;

type FetchFn = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

describe("safe-fetch decodes response bodies itself", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockResolve6.mockRejectedValue(new Error("no AAAA records"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("offers only the encodings it decodes", async () => {
    const response = await createSafeFetch()(urlFor("gzip"));

    expect(response.headers.get("x-accept-encoding")).toBe("deflate, gzip");
  });

  it.each(["gzip", "deflate"])("decodes a %s body", async (encoding) => {
    const response = await createSafeFetch()(urlFor(encoding));

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(ICS_BODY);
  });

  it("rejects a brotli body without decoding it", async () => {
    await expect(createSafeFetch()(urlFor("br"))).rejects.toBeInstanceOf(UrlSafetyError);
  });

  it("turns off runtime decompression on pinned requests", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);

    const mockFetch = vi.fn<FetchFn>(() => Promise.resolve(new Response(ICS_BODY)));
    Object.assign(globalThis, { fetch: mockFetch });

    await createSafeFetch({ blockPrivateResolution: true })("https://calendar.example.com/feed.ics");

    const init = mockFetch.mock.calls.at(0)?.[1];
    expect(init).toMatchObject({ decompress: false });
    expect(new Headers(init?.headers).get("accept-encoding")).toBe("deflate, gzip");
  });
});
