import { Text } from "@/components/ui/primitives/text";

interface ConsentClientSummaryProps {
  clientName: string | null;
  redirectDestination: string | null;
}

function ClientRequest({ clientName }: { clientName: string | null }) {
  if (!clientName) {
    return (
      <Text size="sm" tone="muted" align="left">
        An app that didn&apos;t give a name is requesting permission to access your Keeper data.
      </Text>
    );
  }

  return (
    <Text size="sm" tone="muted" align="left">
      An app calling itself{" "}
      <span className="font-medium text-foreground">&ldquo;{clientName}&rdquo;</span>{" "}
      is requesting permission to access your Keeper data. Keeper.sh hasn&apos;t verified this name.
    </Text>
  );
}

function RedirectWarning({ redirectDestination }: { redirectDestination: string | null }) {
  if (!redirectDestination) {
    return null;
  }

  return (
    <Text size="sm" tone="muted" align="left">
      If you allow it, you&apos;ll be sent to{" "}
      <span className="font-medium text-foreground break-words">{redirectDestination}</span>
      . Only continue if you trust that address.
    </Text>
  );
}

export function ConsentClientSummary({ clientName, redirectDestination }: ConsentClientSummaryProps) {
  return (
    <>
      <ClientRequest clientName={clientName} />
      <RedirectWarning redirectDestination={redirectDestination} />
    </>
  );
}
