import { createFileRoute } from "@tanstack/react-router";
import { LinkOAuthPreamble } from "@/features/auth/components/oauth-preamble";
import { CalendarConsentContinuation } from "@/features/auth/components/calendar-consent-continuation";
import { isConsentContinuation } from "@/lib/sign-up-continuation";

interface ConnectSearch {
  continue?: "consent";
}

export const Route = createFileRoute("/(dashboard)/dashboard/connect/google")({
  validateSearch: (search: Record<string, unknown>): ConnectSearch => ({
    continue: isConsentContinuation(search.continue) ? search.continue : undefined,
  }),
  component: ConnectGooglePage,
});

function ConnectGooglePage() {
  const search = Route.useSearch();
  if (search.continue) return <CalendarConsentContinuation provider="google" />;
  return <LinkOAuthPreamble provider="google" />;
}
