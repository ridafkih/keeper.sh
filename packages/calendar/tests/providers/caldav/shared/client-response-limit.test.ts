import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_CALDAV_RESPONSE_BYTES } from "../../../../src/providers/caldav/shared/api";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";
import { isResponseTooLargeError, ResponseTooLargeError } from "../../../../src/utils/bounded-response";
import { createEndlessGzipBody, startRemoteBodyServer } from "../../../utils/remote-body-server";

const CALENDAR_PATH = "/cal/user/";
const OBJECT_HREF = `${CALENDAR_PATH}event-1.ics`;
const XML_HEADERS = { "content-type": "application/xml; charset=utf-8" };
const LISTING = [
  "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
  "<d:multistatus xmlns:d=\"DAV:\">",
  `<d:response><d:href>${OBJECT_HREF}</d:href>`,
  "<d:propstat><d:prop><d:getetag>\"etag-1\"</d:getetag></d:prop>",
  "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>",
  "</d:multistatus>",
].join("");
const RESPONSE_ROW = Buffer.from(
  `<d:response><d:href>${CALENDAR_PATH}${"a".repeat(1024)}.ics</d:href></d:response>`.repeat(512),
);

const endlessListing = createEndlessGzipBody(RESPONSE_ROW, XML_HEADERS);
const endlessObjects = createEndlessGzipBody(RESPONSE_ROW, XML_HEADERS);

const readRequestBody = async (request: AsyncIterable<Buffer>): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const captureRejection = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the CalDAV request to be rejected");
};

const answerObjectsRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const body = await readRequestBody(request);
  if (body.includes("calendar-multiget")) {
    endlessObjects.handler(request, response);
    return;
  }
  response.writeHead(207, XML_HEADERS);
  response.end(LISTING.replaceAll(CALENDAR_PATH, `/objects${CALENDAR_PATH}`));
};

const server = await startRemoteBodyServer({
  [`/listing${CALENDAR_PATH}`]: endlessListing.handler,
  [`/objects${CALENDAR_PATH}`]: (request, response) => {
    answerObjectsRequest(request, response).catch(() => response.destroy());
  },
});

const createClient = (basePath: string): CalDAVClient =>
  new CalDAVClient({
    authMethod: "basic",
    credentials: { password: "pass", username: "user" },
    serverUrl: server.url(basePath),
  });

afterAll(async () => {
  await server.close();
});

describe("CalDAV response size limit", () => {
  it("stops a calendar listing that never ends", async () => {
    const client = createClient("/listing/");
    const residentBefore = process.memoryUsage().rss;

    const error = await captureRejection(
      client.fetchCalendarObjects({ calendarUrl: server.url(`/listing${CALENDAR_PATH}`) }),
    );
    const residentGrowth = process.memoryUsage().rss - residentBefore;
    await endlessListing.tracker.hungUp;

    expect(error).toBeInstanceOf(ResponseTooLargeError);
    expect(error).toMatchObject({ limitBytes: MAX_CALDAV_RESPONSE_BYTES });
    expect(residentGrowth).toBeLessThan(MAX_CALDAV_RESPONSE_BYTES * 4);
  });

  it("stops a multiget response that never ends", async () => {
    const client = createClient("/objects/");

    const error = await captureRejection(
      client.fetchCalendarObjects({ calendarUrl: server.url(`/objects${CALENDAR_PATH}`) }),
    );
    await endlessObjects.tracker.hungUp;

    expect(isResponseTooLargeError(error)).toBe(true);
  });

  it("does not mistake an oversized response for rejected credentials", async () => {
    const client = createClient("/listing/");

    const error = await captureRejection(
      client.fetchCalendarObjects({ calendarUrl: server.url(`/listing${CALENDAR_PATH}`) }),
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });
});
