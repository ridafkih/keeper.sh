import { createFileRoute } from "@tanstack/react-router";
import { LinkOAuthPreamble } from "@/features/auth/components/oauth-preamble";
import { Callout } from "@/components/ui/primitives/callout";

export const Route = createFileRoute("/(oauth)/dashboard/connect/outlook")({
  component: () => (
    <LinkOAuthPreamble provider="outlook">
      <Callout>
        If your organization blocks third-party connections, use an ICS link instead. <a href="/blog/ics-workaround" className="underline underline-offset-2">Learn more</a>
      </Callout>
    </LinkOAuthPreamble>
  ),
});
