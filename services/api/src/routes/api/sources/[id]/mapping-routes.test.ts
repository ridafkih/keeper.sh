import { describe, expect, it } from "bun:test";
import {
  handleGetSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
  handlePutSourceDestinationsRoute,
  handlePutSourcesForDestinationRoute,
} from "./mapping-routes";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "../../../../utils/source-destination-mappings";

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
        setDestinationsForSource: () => Promise.resolve(),
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
        setDestinationsForSource: () =>
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
        setDestinationsForSource: () =>
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
        setDestinationsForSource: () =>
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
        setSourcesForDestination: () => Promise.resolve(),
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
        setSourcesForDestination: () =>
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
        setSourcesForDestination: () =>
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
        setSourcesForDestination: () =>
          Promise.reject(new Error(MAPPING_LIMIT_ERROR_MESSAGE)),
      },
    );

    expect(response.status).toBe(402);
    expect(await readJson(response)).toEqual({
      error: MAPPING_LIMIT_ERROR_MESSAGE,
    });
  });
});
