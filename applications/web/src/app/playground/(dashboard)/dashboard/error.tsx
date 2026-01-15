"use client";

import { useEffect } from "react";
import { Button, ButtonText, Heading2, Copy } from "@keeper.sh/ui";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const DashboardPageError = ({ error, reset }: ErrorPageProps) => {
  useEffect(() => {
    console.error("Dashboard page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Heading2>Unable to Load Dashboard</Heading2>
        <Copy>
          We encountered an error while loading your calendar data. Please try refreshing the page.
        </Copy>
        {error.digest && (
          <Copy className="text-xs text-foreground-subtle">Error ID: {error.digest}</Copy>
        )}
      </div>
      <Button variant="primary" size="default" onClick={reset} className="w-fit">
        <ButtonText>Refresh</ButtonText>
      </Button>
    </div>
  );
};

export default DashboardPageError;
