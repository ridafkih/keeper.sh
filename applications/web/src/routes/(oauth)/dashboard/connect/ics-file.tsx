import { createFileRoute } from "@tanstack/react-router";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import { Heading2 } from "../../../../components/ui/primitives/heading";
import { Text } from "../../../../components/ui/primitives/text";
import { ProviderIconPair } from "../../../../features/auth/components/oauth-preamble";
import { ButtonText, LinkButton } from "../../../../components/ui/primitives/button";

export const Route = createFileRoute(
  "/(oauth)/dashboard/connect/ics-file",
)({
  component: ConnectICSFilePage,
});

function ConnectICSFilePage() {
  return (
    <>
      <ProviderIconPair>
        <Calendar size={28} className="text-foreground-muted" />
      </ProviderIconPair>
      <Heading2 as="h1">Upload ICS File</Heading2>
      <Text size="sm" tone="muted" align="left">
        ICS snapshot uploads are not available in Canary yet. Use an ICS feed link to keep your events synced.
      </Text>
      <LinkButton to="/dashboard/connect/ical-link" className="w-full justify-center">
        <ButtonText>Use ICS Feed Instead</ButtonText>
      </LinkButton>
    </>
  );
}
