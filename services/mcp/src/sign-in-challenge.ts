import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type SignInChallengeReason = "invalid_token" | "insufficient_scope";

interface SignInChallenge {
  reason: SignInChallengeReason;
  resourceMetadataUrl: string;
  scopes: string[];
}

const WWW_AUTHENTICATE_META_KEY = "mcp/www_authenticate";

const SIGN_IN_CHALLENGE_DESCRIPTIONS: Record<SignInChallengeReason, string> = {
  invalid_token: "Sign in to Keeper.sh to use this tool.",
  insufficient_scope: "Allow Keeper.sh the access this tool needs.",
};

const formatSignInChallenge = ({ reason, resourceMetadataUrl, scopes }: SignInChallenge): string =>
  [
    `Bearer resource_metadata="${resourceMetadataUrl}"`,
    `error="${reason}"`,
    `error_description="${SIGN_IN_CHALLENGE_DESCRIPTIONS[reason]}"`,
    `scope="${scopes.join(" ")}"`,
  ].join(", ");

const createSignInChallengeToolResult = (challenge: SignInChallenge): CallToolResult => ({
  content: [{ type: "text", text: SIGN_IN_CHALLENGE_DESCRIPTIONS[challenge.reason] }],
  isError: true,
  _meta: { [WWW_AUTHENTICATE_META_KEY]: [formatSignInChallenge(challenge)] },
});

export { WWW_AUTHENTICATE_META_KEY, createSignInChallengeToolResult, formatSignInChallenge };
export type { SignInChallenge, SignInChallengeReason };
