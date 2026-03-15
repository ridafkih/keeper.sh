import { createFileRoute } from "@tanstack/react-router";
import { CalDAVConnectPage } from "@/features/auth/components/caldav-connect-page";

export const Route = createFileRoute("/(oauth)/dashboard/connect/apple")({
  component: ConnectApplePage,
});

function ConnectApplePage() {
  return (
    <CalDAVConnectPage
      provider="icloud"
      icon={<img src="/integrations/icon-icloud.svg" alt="iCloud" width={40} height={40} className="size-full rounded-lg p-3" />}
      heading="Connect Apple Calendar"
      description="iCloud uses an app-specific password to authenticate Keeper.sh to interact with your calendar."
      steps={[
        <>
          Navigate to{" "}
          <a href="https://appleid.apple.com" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            iCloud Apple ID
          </a>
        </>,
        "Sign in with your Apple ID",
        <>Select &ldquo;App-Specific Passwords&rdquo;</>,
        <>Click the &ldquo;+&rdquo; next to &ldquo;Passwords&rdquo;</>,
        "Label and generate the password, then copy it",
        "Paste the app-specific password below",
      ]}
    />
  );
}
