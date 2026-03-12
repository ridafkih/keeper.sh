import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, type AuthScreenCopy } from "../../features/auth/components/auth-form";
import { fetchAuthCapabilitiesWithApi } from "../../lib/auth-capabilities";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "../../lib/mcp-auth-flow";

export const Route = createFileRoute("/(auth)/register")({
  loader: ({ context }) => fetchAuthCapabilitiesWithApi(context.fetchApi),
  component: RegisterPage,
  validateSearch: toStringSearchParams,
});

const copy: AuthScreenCopy = {
  heading: "Create your account",
  subtitle: "Get started with Keeper.sh for free",
  oauthActionLabel: "Sign up",
  submitLabel: "Sign up",
  switchPrompt: "Already have an account?",
  switchCta: "Sign in",
  switchTo: "/login",
  action: "signUp",
};

function RegisterPage() {
  const capabilities = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <AuthForm
      capabilities={capabilities}
      copy={copy}
      continuationSearch={getMcpAuthorizationSearch(search) ?? undefined}
    />
  );
}
