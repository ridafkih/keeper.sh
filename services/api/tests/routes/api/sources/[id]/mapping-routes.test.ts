import { describe, expect, it } from "vitest";
import {
  handleGetSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
  handlePatchSourceDestinationsRoute,
  handlePatchSourcesForDestinationRoute,
  handlePutSourceDestinationsRoute,
  handlePutSourcesForDestinationRoute,
} from "../../../../../src/routes/api/sources/[id]/mapping-routes";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "@/utils/source-destination-mappings";

const readJson = (response: Response): Promise<unknown> => response.json();

describe("handleGetSourceDestinationsRoute", () => {
  it("returns 400 when source id param is missing", async () => {
    const response = await handleGetSourceDestinationsRoute(
      { params: {}, userId: "user-1" },
      {
        getDestinationsForSource: () => Promise.resolve([]),
        sourceExists: () => Promise.resolve(true),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when source is not owned by user", async () => {
    const response = await handleGetSourceDestinationsRoute(
      { params: { id: "source-1" }, userId: "user-1" },
      {
        getDestinationsForSource: () => Promise.resolve([]),
        sourceExists: () => Promise.resolve(false),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns linked destination IDs for valid source", async () => {
    const response = await handleGetSourceDestinationsRoute(
      { params: { id: "source-1" }, userId: "user-1" },
      {
        getDestinationsForSource: () => Promise.resolve(["dest-1", "dest-2"]),
        sourceExists: () => Promise.resolve(true),
      },
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ destinationIds: ["dest-1", "dest-2"] });
  });
});

describe("handlePutSourceDestinationsRoute", () => {
  it("returns 400 when request body is invalid", async () => {
    const response = await handlePutSourceDestinationsRoute(
      {
        body: { calendarIds: "not-an-array" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        changeDestinationsForSource: () => Promise.resolve({ nextIds: [], previousIds: [] }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for missing source calendar errors", async () => {
    const response = await handlePutSourceDestinationsRoute(
      {
        body: { calendarIds: ["dest-1"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        changeDestinationsForSource: () =>
          Promise.reject(new Error("Source calendar not found")),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid destination calendar errors", async () => {
    const response = await handlePutSourceDestinationsRoute(
      {
        body: { calendarIds: ["dest-1"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        changeDestinationsForSource: () =>
          Promise.reject(new Error("Some destination calendars not found")),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "Some destination calendars not found",
    });
  });

  it("returns 402 when mapping limit is reached", async () => {
    const response = await handlePutSourceDestinationsRoute(
      {
        body: { calendarIds: ["dest-1"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        changeDestinationsForSource: () =>
          Promise.reject(new Error(MAPPING_LIMIT_ERROR_MESSAGE)),
      },
    );

    expect(response.status).toBe(402);
    expect(await readJson(response)).toEqual({
      error: MAPPING_LIMIT_ERROR_MESSAGE,
    });
  });
});

describe("handleGetSourcesForDestinationRoute", () => {
  it("returns 400 when destination id param is missing", async () => {
    const response = await handleGetSourcesForDestinationRoute(
      { params: {}, userId: "user-1" },
      {
        destinationExists: () => Promise.resolve(true),
        getSourcesForDestination: () => Promise.resolve([]),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when destination is not owned by user", async () => {
    const response = await handleGetSourcesForDestinationRoute(
      { params: { id: "dest-1" }, userId: "user-1" },
      {
        destinationExists: () => Promise.resolve(false),
        getSourcesForDestination: () => Promise.resolve([]),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns linked source IDs for valid destination", async () => {
    const response = await handleGetSourcesForDestinationRoute(
      { params: { id: "dest-1" }, userId: "user-1" },
      {
        destinationExists: () => Promise.resolve(true),
        getSourcesForDestination: () => Promise.resolve(["source-1"]),
      },
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ sourceIds: ["source-1"] });
  });
});

describe("handlePutSourcesForDestinationRoute", () => {
  it("returns 400 when request body is invalid", async () => {
    const response = await handlePutSourcesForDestinationRoute(
      {
        body: { calendarIds: "bad-value" },
        params: { id: "dest-1" },
        userId: "user-1",
      },
      {
        changeSourcesForDestination: () => Promise.resolve({ nextIds: [], previousIds: [] }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for missing destination calendar errors", async () => {
    const response = await handlePutSourcesForDestinationRoute(
      {
        body: { calendarIds: ["source-1"] },
        params: { id: "dest-1" },
        userId: "user-1",
      },
      {
        changeSourcesForDestination: () =>
          Promise.reject(new Error("Destination calendar not found")),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid source calendar errors", async () => {
    const response = await handlePutSourcesForDestinationRoute(
      {
        body: { calendarIds: ["source-1"] },
        params: { id: "dest-1" },
        userId: "user-1",
      },
      {
        changeSourcesForDestination: () =>
          Promise.reject(new Error("Some source calendars not found")),
      },
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: "Some source calendars not found",
    });
  });

  it("returns 402 when mapping limit is reached", async () => {
    const response = await handlePutSourcesForDestinationRoute(
      {
        body: { calendarIds: ["source-1"] },
        params: { id: "dest-1" },
        userId: "user-1",
      },
      {
        changeSourcesForDestination: () =>
          Promise.reject(new Error(MAPPING_LIMIT_ERROR_MESSAGE)),
      },
    );

    expect(response.status).toBe(402);
    expect(await readJson(response)).toEqual({
      error: MAPPING_LIMIT_ERROR_MESSAGE,
    });
  });
});

describe("handlePatchSourceDestinationsRoute", () => {
  it("applies one toggle and returns the destinations the source now has", async () => {
    const changes: unknown[] = [];
    const response = await handlePatchSourceDestinationsRoute(
      { body: { calendarId: "dest-2", enabled: true }, params: { id: "source-1" }, userId: "user-1" },
      {
        changeDestinationsForSource: (_userId, _sourceId, change) => {
          changes.push(change);
          return Promise.resolve({ nextIds: ["dest-1", "dest-2"], previousIds: ["dest-1"] });
        },
      },
    );

    expect(changes).toEqual([{ calendarId: "dest-2", enabled: true, kind: "toggle" }]);
    expect(await readJson(response)).toEqual({ destinationIds: ["dest-1", "dest-2"] });
  });

  it("rejects a toggle without a calendar id", async () => {
    const response = await handlePatchSourceDestinationsRoute(
      { body: { enabled: true }, params: { id: "source-1" }, userId: "user-1" },
      { changeDestinationsForSource: () => Promise.resolve({ nextIds: [], previousIds: [] }) },
    );

    expect(response.status).toBe(400);
  });
});

describe("handlePatchSourcesForDestinationRoute", () => {
  it("applies one toggle and returns the sources the destination now has", async () => {
    const response = await handlePatchSourcesForDestinationRoute(
      { body: { calendarId: "source-2", enabled: false }, params: { id: "dest-1" }, userId: "user-1" },
      {
        changeSourcesForDestination: () =>
          Promise.resolve({ nextIds: ["source-1"], previousIds: ["source-1", "source-2"] }),
      },
    );

    expect(await readJson(response)).toEqual({ sourceIds: ["source-1"] });
  });
});
