import { createFileRoute } from "@tanstack/react-router";
import { CalDAVConnectPage } from "@/features/auth/components/caldav-connect-page";
import { AppPasswordHelp } from "@/features/auth/components/app-password-help";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/connect/fastmail",
)({
  component: ConnectFastmailPage,
});

function ConnectFastmailPage() {
  return (
    <CalDAVConnectPage
      provider="fastmail"
      icon={<img src="/integrations/icon-fastmail.svg" alt="Fastmail" width={40} height={40} className="size-full rounded-lg p-3" />}
      heading="Connect Fastmail"
      credentialHelp={
        <AppPasswordHelp
          provider="fastmail"
          settingsUrl="https://www.fastmail.com/settings/security/devicekeys"
          settingsLabel="Open Fastmail settings"
          sectionLabel="Choose Manage app passwords and access"
        />
      }
      description="Fastmail uses an app-specific password to authenticate Keeper.sh to interact with your calendar."
      steps={[
        <>
          Navigate to{" "}
          <a href="https://www.fastmail.com/settings/security/devicekeys" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            Fastmail Settings
          </a>
        </>,
        <>Click &ldquo;Manage app passwords and access&rdquo;</>,
        <>Click &ldquo;New app password&rdquo;</>,
        <>Leave access on &ldquo;Mail, Contacts &amp; Calendars&rdquo;</>,
        <>Click &ldquo;Generate password&rdquo;</>,
        "Copy the password, and paste it below",
      ]}
    />
  );
}
