"use client";

import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { Heading2 } from "./heading";
import { Copy } from "./copy";

interface ErrorBoundaryProps {
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<PropsWithChildren<ErrorBoundaryProps>, ErrorBoundaryState> {
  static displayName = "ErrorBoundary";

  constructor(props: PropsWithChildren<ErrorBoundaryProps>) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);

    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      return <DefaultErrorFallback error={this.state.error} reset={this.reset} />;
    }

    return this.props.children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error;
  reset: () => void;
}

function DefaultErrorFallback({ error, reset }: DefaultErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[25rem] p-8">
      <div className="flex flex-col gap-4 max-w-md text-center">
        <div className="text-6xl">⚠️</div>
        <Heading2>Something went wrong</Heading2>
        <Copy size="sm" color="secondary">
          {error.message || "An unexpected error occurred"}
        </Copy>
        {process.env.NODE_ENV === "development" && (
          <pre className="text-left text-xs bg-surface-muted p-4 rounded-lg overflow-auto max-h-40">
            {error.stack}
          </pre>
        )}
        <button
          onClick={reset}
          className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:brightness-90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export { ErrorBoundary };
export type { ErrorBoundaryProps };
