import { createFileRoute } from "@tanstack/react-router";
import { CalDAVConnectPage } from "../../../../features/auth/components/caldav-connect-page";

export const Route = createFileRoute(
  "/(oauth)/dashboard/connect/fastmail",
)({
  component: ConnectFastmailPage,
});

function ConnectFastmailPage() {
  return (
    <CalDAVConnectPage
      provider="fastmail"
      icon={<img src="/integrations/icon-fastmail.svg" alt="Fastmail" width={40} height={40} className="size-full rounded-lg p-3" />}
      heading="Connect Fastmail"
      description="Fastmail uses an app-specific password to authenticate Keeper.sh to interact with your calendar."
      steps={[
        <>
          Navigate to{" "}
          <a href="https://www.fastmail.com/settings/security/devicekeys" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            Fastmail Settings
          </a>
        </>,
        <>Click &ldquo;Manage app password and access&rdquo;</>,
        <>Click &ldquo;New app password&rdquo;</>,
        <>Under &ldquo;Access&rdquo;, select &ldquo;Calendars (CalDAV)&rdquo;</>,
        <>Click &ldquo;Generate password&rdquo;</>,
        "Copy the password, and paste it below",
      ]}
    />
  );
}
