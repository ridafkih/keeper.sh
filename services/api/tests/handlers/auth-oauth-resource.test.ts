import { describe, expect, it } from "bun:test";
import { prepareOAuthTokenRequest } from "../../src/handlers/auth-oauth-resource";

describe("prepareOAuthTokenRequest", () => {
  it("injects resource for authorization_code token exchange when missing", async () => {
    const request = new Request("https://keeper.sh/api/auth/oauth2/token", {
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "code-1",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    const preparedRequest = await prepareOAuthTokenRequest({
      mcpPublicUrl: "https://www.keeper.sh/mcp",
      pathname: "/api/auth/oauth2/token",
      request,
    });

    const updatedBody = await preparedRequest.request.text();
    const params = new URLSearchParams(updatedBody);

    expect(preparedRequest.mcpResourceInjected).toBe(true);
    expect(params.get("resource")).toBe("https://www.keeper.sh/mcp");
  });

  it("does not override existing resource", async () => {
    const request = new Request("https://keeper.sh/api/auth/oauth2/token", {
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "code-1",
        resource: "https://custom.example/mcp",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    const preparedRequest = await prepareOAuthTokenRequest({
      mcpPublicUrl: "https://www.keeper.sh/mcp",
      pathname: "/api/auth/oauth2/token",
      request,
    });

    const updatedBody = await preparedRequest.request.text();
    const params = new URLSearchParams(updatedBody);

    expect(preparedRequest.mcpResourceInjected).toBe(false);
    expect(params.get("resource")).toBe("https://custom.example/mcp");
  });

  it("does nothing for non-token routes", async () => {
    const request = new Request("https://keeper.sh/api/auth/sign-in/email", {
      body: "email=a%40b.com",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    const preparedRequest = await prepareOAuthTokenRequest({
      mcpPublicUrl: "https://www.keeper.sh/mcp",
      pathname: "/api/auth/sign-in/email",
      request,
    });

    const updatedBody = await preparedRequest.request.text();
    expect(preparedRequest.mcpResourceInjected).toBe(false);
    expect(updatedBody).toBe("email=a%40b.com");
  });
});
