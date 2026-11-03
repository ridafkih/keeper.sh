import { createFileRoute } from "@tanstack/react-router";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import { Text } from "@/components/ui/primitives/text";
import { CalDAVConnectPage } from "@/features/auth/components/caldav-connect-page";

export const Route = createFileRoute("/(oauth)/dashboard/connect/caldav")({
  component: ConnectCalDAVPage,
});

function ConnectCalDAVPage() {
  return (
    <CalDAVConnectPage
      provider="caldav"
      icon={<Calendar size={28} className="text-foreground-muted" />}
      heading="Connect CalDAV Server"
      description="Connect to any CalDAV-compatible server."
      steps={[
        "Enter your CalDAV server URL",
        "Provide a username",
        "Enter a password, or app-specific password",
        <>Click &ldquo;Connect&rdquo;</>,
      ]}
      footer={
        <Text size="sm" tone="muted" align="left">
          Your CalDAV server URL can typically be found in your calendar provider&apos;s settings or documentation.
        </Text>
      }
    />
  );
}
