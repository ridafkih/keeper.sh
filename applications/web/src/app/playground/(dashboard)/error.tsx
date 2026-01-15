"use client";

import { useEffect } from "react";
import { Button, ButtonText, Heading2, Copy } from "@keeper.sh/ui";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const DashboardErrorPage = ({ error, reset }: ErrorPageProps) => {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <Heading2>Dashboard Error</Heading2>
      <Copy>
        An error occurred while loading the dashboard. Your data is safe, but we encountered an issue
        displaying it.
      </Copy>
      {error.digest && (
        <Copy className="text-xs text-foreground-subtle">Error ID: {error.digest}</Copy>
      )}
      <Button variant="primary" onClick={reset}>
        <ButtonText>Reload Dashboard</ButtonText>
      </Button>
    </div>
  );
};

export default DashboardErrorPage;
