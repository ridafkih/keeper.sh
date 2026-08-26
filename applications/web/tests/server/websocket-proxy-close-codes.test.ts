import { describe, expect, it } from "vitest";
import { toForwardableCloseCode, websocketProxyHandlers } from "../../src/server/proxy/websocket";
import type { SocketConnection } from "../../src/server/types";

interface UpstreamStub extends WebSocket {
  closeCalls: Array<{ code: number | undefined; reason: string | undefined }>;
}

function createUpstream(readyState: number = WebSocket.OPEN): UpstreamStub {
  const closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];

  return {
    binaryType: "arraybuffer",
    close(code?: number, reason?: string) {
      const isReserved = code !== undefined
        && (code < 1000 || (code >= 1004 && code <= 1006) || (code > 1014 && code < 3000) || code > 4999);
      if (isReserved) {
        throw new DOMException(
          `The close code must be a valid WebSocket close code. Received ${code}.`,
          "InvalidAccessError",
        );
      }
      closeCalls.push({ code, reason });
    },
    closeCalls,
    readyState,
  } as unknown as UpstreamStub;
}

function createClient(upstreamSocket: WebSocket | null): SocketConnection {
  return {
    data: { targetUrl: "ws://api.test/api/socket", upstreamSocket },
    readyState: 1,
  } as unknown as SocketConnection;
}

describe("websocket proxy close codes", () => {
  it("does not forward the reserved 1005 code when a client disconnects without a status", () => {
    const upstream = createUpstream();
    const client = createClient(upstream);

    expect(() => websocketProxyHandlers.close(client, 1005, "")).not.toThrow();
    expect(upstream.closeCalls).toHaveLength(1);
    expect(upstream.closeCalls[0]?.code).not.toBe(1005);
  });

  it("does not forward the reserved 1006 code when a client connection drops abnormally", () => {
    const upstream = createUpstream();
    const client = createClient(upstream);

    expect(() => websocketProxyHandlers.close(client, 1006, "")).not.toThrow();
    expect(upstream.closeCalls).toHaveLength(1);
    expect(upstream.closeCalls[0]?.code).not.toBe(1006);
  });

  it("forwards close codes the WebSocket API accepts", () => {
    const upstream = createUpstream();
    const client = createClient(upstream);

    websocketProxyHandlers.close(client, 1001, "going away");

    expect(upstream.closeCalls).toEqual([{ code: 1001, reason: "going away" }]);
  });

  it("forwards application close codes in the 3000-4999 range", () => {
    const upstream = createUpstream();
    const client = createClient(upstream);

    websocketProxyHandlers.close(client, 4000, "app specific");

    expect(upstream.closeCalls).toEqual([{ code: 4000, reason: "app specific" }]);
  });

  it("maps every code the WebSocket API rejects onto a normal closure", () => {
    expect(toForwardableCloseCode(undefined)).toBe(1000);
    expect(toForwardableCloseCode(1004)).toBe(1000);
    expect(toForwardableCloseCode(1005)).toBe(1000);
    expect(toForwardableCloseCode(1006)).toBe(1000);
    expect(toForwardableCloseCode(999)).toBe(1000);
    expect(toForwardableCloseCode(2000)).toBe(1000);
    expect(toForwardableCloseCode(5000)).toBe(1000);
  });

  it("preserves every code the WebSocket API accepts", () => {
    expect(toForwardableCloseCode(1000)).toBe(1000);
    expect(toForwardableCloseCode(1001)).toBe(1001);
    expect(toForwardableCloseCode(1014)).toBe(1014);
    expect(toForwardableCloseCode(3000)).toBe(3000);
    expect(toForwardableCloseCode(4999)).toBe(4999);
  });

  it("clears the upstream reference after closing", () => {
    const upstream = createUpstream();
    const client = createClient(upstream);

    websocketProxyHandlers.close(client, 1005, "");

    expect(client.data.upstreamSocket).toBeNull();
  });
});
