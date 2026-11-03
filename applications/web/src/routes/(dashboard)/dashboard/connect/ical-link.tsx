import { createFileRoute } from "@tanstack/react-router";
import Link from "lucide-react/dist/esm/icons/link";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ProviderIconPair } from "@/features/auth/components/oauth-preamble";
import { ICSFeedForm } from "@/features/auth/components/ics-connect-form";

export const Route = createFileRoute(
  "/(oauth)/dashboard/connect/ical-link",
)({
  component: ConnectICalLinkPage,
});

function ConnectICalLinkPage() {
  return (
    <>
      <ProviderIconPair>
        <Link size={28} className="text-foreground-muted" />
      </ProviderIconPair>
      <Heading2 as="h1">Subscribe with a calendar link</Heading2>
      <Text size="sm" tone="muted" align="left">
        Paste the link your calendar app gives you for sharing or subscribing.
      </Text>
      <ICSFeedForm />
    </>
  );
}
