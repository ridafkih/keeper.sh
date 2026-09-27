import { describe, expect, it } from "vitest";
import {
  handleGetSourceDestinationsRoute,
  handleGetSourcesForDestinationRoute,
} from "../../../../../src/routes/api/sources/[id]/mapping-routes";

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
