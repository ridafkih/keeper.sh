"use client";

import { useEffect } from "react";
import { Button, ButtonText, Heading2, Copy } from "@keeper.sh/ui";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const ErrorPage = ({ error, reset }: ErrorPageProps) => {
  useEffect(() => {
    console.error("Playground error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <Heading2>Something went wrong</Heading2>
      <Copy>
        An error occurred while loading this page. Please try again or contact support if the problem
        persists.
      </Copy>
      {error.digest && (
        <Copy className="text-xs text-foreground-subtle">Error ID: {error.digest}</Copy>
      )}
      <Button variant="primary" onClick={reset}>
        <ButtonText>Try Again</ButtonText>
      </Button>
    </div>
  );
};

export default ErrorPage;
