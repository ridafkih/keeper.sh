import { describe, expect, it } from "bun:test";
import {
  buildBatchRequestBody,
  parseBatchResponseBody,
  chunkArray,
  extractResponseBoundary,
} from "../../../../src/providers/google/shared/batch";
import type { BatchSubRequest } from "../../../../src/providers/google/shared/batch";

describe("buildBatchRequestBody", () => {
  it("serializes a single POST sub-request with JSON body", () => {
    const subRequests: BatchSubRequest[] = [
      {
        method: "POST",
        path: "/calendar/v3/calendars/primary/events",
        body: { summary: "Test Event" },
      },
    ];

    const result = buildBatchRequestBody(subRequests, "test_boundary");

    expect(result).toContain("--test_boundary");
    expect(result).toContain("Content-Type: application/http");
    expect(result).toContain("Content-ID: <item-0>");
    expect(result).toContain("POST /calendar/v3/calendars/primary/events HTTP/1.1");
    expect(result).toContain('"summary":"Test Event"');
    expect(result).toContain("--test_boundary--");
  });

  it("serializes a DELETE sub-request without body", () => {
    const subRequests: BatchSubRequest[] = [
      {
        method: "DELETE",
        path: "/calendar/v3/calendars/primary/events/abc123",
      },
    ];

    const result = buildBatchRequestBody(subRequests, "boundary_del");

    expect(result).toContain("DELETE /calendar/v3/calendars/primary/events/abc123 HTTP/1.1");
    expect(result).not.toContain('"summary"');
  });

  it("serializes multiple sub-requests with sequential content IDs", () => {
    const subRequests: BatchSubRequest[] = [
      { method: "POST", path: "/events", body: { summary: "Event A" } },
      { method: "POST", path: "/events", body: { summary: "Event B" } },
      { method: "DELETE", path: "/events/xyz" },
    ];

    const result = buildBatchRequestBody(subRequests, "multi");

    expect(result).toContain("Content-ID: <item-0>");
    expect(result).toContain("Content-ID: <item-1>");
    expect(result).toContain("Content-ID: <item-2>");
  });

  it("includes custom headers in sub-requests", () => {
    const subRequests: BatchSubRequest[] = [
      {
        method: "GET",
        path: "/events",
        headers: { "If-None-Match": "etag-value" },
      },
    ];

    const result = buildBatchRequestBody(subRequests, "hdr");

    expect(result).toContain("If-None-Match: etag-value");
  });
});

describe("parseBatchResponseBody", () => {
  it("parses a single successful response", () => {
    const responseText = [
      "--response_boundary",
      "Content-Type: application/http",
      "Content-ID: <response-item-0>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      "",
      '{"id": "event123", "summary": "Test"}',
      "--response_boundary--",
    ].join("\r\n");

    const results = parseBatchResponseBody(responseText, "response_boundary");

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(200);
    expect(results[0]?.body).toEqual({ id: "event123", summary: "Test" });
  });

  it("parses multiple responses preserving order by Content-ID", () => {
    const responseText = [
      "--batch_resp",
      "Content-Type: application/http",
      "Content-ID: <response-item-1>",
      "",
      "HTTP/1.1 201 Created",
      "Content-Type: application/json",
      "",
      '{"id": "second"}',
      "--batch_resp",
      "Content-Type: application/http",
      "Content-ID: <response-item-0>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      "",
      '{"id": "first"}',
      "--batch_resp--",
    ].join("\r\n");

    const results = parseBatchResponseBody(responseText, "batch_resp");

    expect(results).toHaveLength(2);
    expect(results[0]?.statusCode).toBe(200);
    expect(results[0]?.body).toEqual({ id: "first" });
    expect(results[1]?.statusCode).toBe(201);
    expect(results[1]?.body).toEqual({ id: "second" });
  });

  it("parses error responses with status codes", () => {
    const responseText = [
      "--err_bound",
      "Content-Type: application/http",
      "Content-ID: <response-item-0>",
      "",
      "HTTP/1.1 404 Not Found",
      "Content-Type: application/json",
      "",
      '{"error": {"message": "Not Found", "code": 404}}',
      "--err_bound--",
    ].join("\r\n");

    const results = parseBatchResponseBody(responseText, "err_bound");

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(404);
  });

  it("handles 204 No Content responses with empty body", () => {
    const responseText = [
      "--del_bound",
      "Content-Type: application/http",
      "Content-ID: <response-item-0>",
      "",
      "HTTP/1.1 204 No Content",
      "",
      "",
      "--del_bound--",
    ].join("\r\n");

    const results = parseBatchResponseBody(responseText, "del_bound");

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(204);
  });

  it("handles mixed success and failure responses", () => {
    const responseText = [
      "--mixed",
      "Content-Type: application/http",
      "Content-ID: <response-item-0>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      "",
      '{"id": "ok"}',
      "--mixed",
      "Content-Type: application/http",
      "Content-ID: <response-item-1>",
      "",
      "HTTP/1.1 429 Too Many Requests",
      "Content-Type: application/json",
      "",
      '{"error": {"message": "Rate Limit Exceeded"}}',
      "--mixed",
      "Content-Type: application/http",
      "Content-ID: <response-item-2>",
      "",
      "HTTP/1.1 201 Created",
      "Content-Type: application/json",
      "",
      '{"id": "created"}',
      "--mixed--",
    ].join("\r\n");

    const results = parseBatchResponseBody(responseText, "mixed");

    expect(results).toHaveLength(3);
    expect(results[0]?.statusCode).toBe(200);
    expect(results[1]?.statusCode).toBe(429);
    expect(results[2]?.statusCode).toBe(201);
  });
});

describe("chunkArray", () => {
  it("chunks array into groups of specified size", () => {
    const items = [1, 2, 3, 4, 5];
    const chunks = chunkArray(items, 2);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual([1, 2]);
    expect(chunks[1]).toEqual([3, 4]);
    expect(chunks[2]).toEqual([5]);
  });

  it("returns single chunk when array fits within size", () => {
    const items = [1, 2, 3];
    const chunks = chunkArray(items, 50);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });

  it("returns empty array for empty input", () => {
    const chunks = chunkArray([], 10);
    expect(chunks).toHaveLength(0);
  });
});

describe("extractResponseBoundary", () => {
  it("extracts boundary from Content-Type header", () => {
    const boundary = extractResponseBoundary("multipart/mixed; boundary=batch_abc123");
    expect(boundary).toBe("batch_abc123");
  });

  it("returns null for missing Content-Type", () => {
    const boundary = extractResponseBoundary(null);
    expect(boundary).toBeNull();
  });

  it("returns null when no boundary parameter present", () => {
    const boundary = extractResponseBoundary("application/json");
    expect(boundary).toBeNull();
  });
});
