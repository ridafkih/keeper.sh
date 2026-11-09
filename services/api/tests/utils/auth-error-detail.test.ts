import { describe, expect, it } from "vitest";
import { readAuthErrorDetail } from "@/utils/auth-error-detail";

const jsonResponse = (status: number, body: unknown) => Response.json(body, { status });

describe("readAuthErrorDetail", () => {
  it("reads the OAuth error and its description from a rejected client registration", async () => {
    const response = jsonResponse(400, {
      error: "invalid_redirect_uri",
      error_description: "redirect_uri must use https",
    });

    expect(await readAuthErrorDetail(response)).toEqual({
      code: "invalid_redirect_uri",
      description: "redirect_uri must use https",
    });
  });

  it("reads better-auth's code and message from a failed endpoint", async () => {
    const response = jsonResponse(500, { message: "Subscriptions list failed" });

    expect(await readAuthErrorDetail(response)).toEqual({
      code: null,
      description: "Subscriptions list failed",
    });
  });

  it("keeps emails and token-like strings out of the description", async () => {
    const response = jsonResponse(422, {
      code: "USER_ALREADY_EXISTS",
      message: "person@example.com already uses eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayload.signature",
    });

    expect(await readAuthErrorDetail(response)).toEqual({
      code: "USER_ALREADY_EXISTS",
      description: "[email] already uses [redacted]",
    });
  });

  it("ignores successful responses", async () => {
    expect(await readAuthErrorDetail(jsonResponse(200, { message: "ok" }))).toBeNull();
  });

  it("ignores error responses without a JSON body", async () => {
    expect(await readAuthErrorDetail(new Response("Bad gateway", { status: 502 }))).toBeNull();
  });

  it("leaves the response body readable for the caller", async () => {
    const response = jsonResponse(400, { error: "invalid_client" });
    await readAuthErrorDetail(response);

    expect(await response.json()).toEqual({ error: "invalid_client" });
  });
});
