import { beforeEach, describe, expect, it, vi } from "vitest";

type Event = Record<string, unknown>;

const flushed: Event[] = [];
let current: Event = {};
const openMock = vi.fn();

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => {
    current = {};
    return await run();
  },
  widelog: {
    errorFields: () => null,
    flush: () => {
      flushed.push(current);
    },
    set: (key: string, value: unknown) => {
      current[key] = value;
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("@/context", () => ({
  database: {},
  getCachedSyncAggregate: () => null,
  getCurrentSyncAggregate: () => null,
  readMappingSyncState: () => null,
}));

vi.mock("@keeper.sh/broadcast", () => ({
  createWebsocketHandler: () => ({
    close: () => null,
    idleTimeout: 60,
    message: () => null,
    open: () => openMock(),
  }),
}));

const { websocketHandler } = await import("../../src/handlers/websocket");

const socket = { data: { userId: "user-1" } } as never;

beforeEach(() => {
  flushed.length = 0;
  openMock.mockReset();
});

describe("websocket connection events", () => {
  it("record a successful open as a success", async () => {
    openMock.mockResolvedValue(null);

    await websocketHandler.open(socket);

    expect(flushed).toEqual([expect.objectContaining({
      "operation.name": "websocket:open",
      outcome: "success",
      "user.id": "user-1",
    })]);
  });

  it("record an open that failed as an error", async () => {
    openMock.mockRejectedValue(new Error("socket closed before the initial state was sent"));

    await expect(websocketHandler.open(socket)).rejects.toThrow();

    expect(flushed).toEqual([expect.objectContaining({ outcome: "error" })]);
  });
});
