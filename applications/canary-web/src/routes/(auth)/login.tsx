import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, type AuthScreenCopy } from "../../features/auth/components/auth-form";
import { fetchAuthCapabilitiesWithApi } from "../../lib/auth-capabilities";
import {
  getMcpAuthorizationSearch,
  toStringSearchParams,
} from "../../lib/mcp-auth-flow";

export const Route = createFileRoute("/(auth)/login")({
  loader: ({ context }) => fetchAuthCapabilitiesWithApi(context.fetchApi),
  component: LoginPage,
  validateSearch: toStringSearchParams,
});

const copy: AuthScreenCopy = {
  heading: "Welcome back",
  subtitle: "Sign in to your Keeper.sh account",
  oauthActionLabel: "Sign in",
  submitLabel: "Sign in",
  switchPrompt: "Don't have an account yet?",
  switchCta: "Register",
  switchTo: "/register",
  action: "signIn",
};

function LoginPage() {
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
