import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { usernameOnly } from "../../src/plugins/username-only";
import type { GenericEndpointContext } from "better-auth";

/*
 * Issue #945: on self-hosted deployments (commercialMode off) the username-only plugin
 * is registered, and social sign-up through Google/Microsoft failed with
 * `username_is_required`. Better Auth validates every plugin-declared required user
 * field when the OAuth callback creates a user, and the provider profile never carries
 * a username, so the plugin must not mark the field as required.
 */
const buildAuth = () =>
  betterAuth({
    baseURL: "http://localhost:3000",
    database: memoryAdapter({ account: [], session: [], user: [], verification: [] }),
    plugins: [usernameOnly()],
    secret: "test-secret",
    socialProviders: {
      google: { clientId: "client-id", clientSecret: "client-secret" },
    },
  });

const buildEndpointContext = async (
  auth: ReturnType<typeof buildAuth>,
): Promise<GenericEndpointContext> => {
  const context = await auth.$context;
  return {
    context,
    path: "/callback/google",
    request: new Request("http://localhost:3000/api/auth/callback/google"),
  } as unknown as GenericEndpointContext;
};

const signUpWithGoogle = async (auth: ReturnType<typeof buildAuth>) =>
  handleOAuthUserInfo(await buildEndpointContext(auth), {
    account: {
      accountId: "google-account-id",
      providerId: "google",
      scope: "openid email",
    },
    callbackURL: "/dashboard",
    userInfo: {
      email: "person@example.com",
      emailVerified: true,
      id: "google-account-id",
      name: "Person",
    },
  });

describe("username-only plugin alongside social sign-up", () => {
  it("registers a user from an OAuth profile that carries no username", async () => {
    const auth = buildAuth();

    const result = await signUpWithGoogle(auth);

    expect(result.error).toBeFalsy();
    expect(result.isRegister).toBe(true);
    expect(result.data?.user.email).toBe("person@example.com");
  });

  it("signs the same OAuth user back in on a later callback", async () => {
    const auth = buildAuth();

    await signUpWithGoogle(auth);
    const result = await signUpWithGoogle(auth);

    expect(result.error).toBeFalsy();
    expect(result.isRegister).toBe(false);
  });

  it("still rejects the plugin's own sign-up when no username is supplied", async () => {
    const auth = buildAuth();

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/username-only/sign-up", {
        body: JSON.stringify({ password: "password123" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("keeps username sign-up and sign-in working", async () => {
    const auth = buildAuth();
    const signUp = await auth.handler(
      new Request("http://localhost:3000/api/auth/username-only/sign-up", {
        body: JSON.stringify({ password: "password123", username: "alice" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(signUp.status).toBe(200);

    const signIn = await auth.handler(
      new Request("http://localhost:3000/api/auth/username-only/sign-in", {
        body: JSON.stringify({ password: "password123", username: "alice" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(signIn.status).toBe(200);
  });
});
