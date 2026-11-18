import { getOAuthState } from "better-auth/api";
import { parseSignUpAttribution } from "@keeper.sh/data-schemas";
import type { SignUpAttribution } from "@keeper.sh/data-schemas";

const SIGN_UP_ATTRIBUTION_KEY = "attribution";

const OAUTH_CALLBACK_PATHS = new Set(["/callback/:id", "/oauth2/callback/:providerId"]);

interface SignUpRequestContext {
  path?: string;
  body?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readBodySignUpAttribution = (body: unknown): SignUpAttribution | null => {
  if (!isRecord(body)) {
    return null;
  }
  return parseSignUpAttribution(body[SIGN_UP_ATTRIBUTION_KEY]);
};

const readOAuthStateSignUpAttribution = async (): Promise<SignUpAttribution | null> => {
  const state = await getOAuthState();
  if (!isRecord(state)) {
    return null;
  }
  return parseSignUpAttribution(state[SIGN_UP_ATTRIBUTION_KEY]);
};

const readSignUpAttribution = (
  context: SignUpRequestContext | null | undefined,
): Promise<SignUpAttribution | null> => {
  if (!context) {
    return Promise.resolve(null);
  }
  if (context.path && OAUTH_CALLBACK_PATHS.has(context.path)) {
    return readOAuthStateSignUpAttribution();
  }
  return Promise.resolve(readBodySignUpAttribution(context.body));
};

export { readBodySignUpAttribution, readSignUpAttribution };
