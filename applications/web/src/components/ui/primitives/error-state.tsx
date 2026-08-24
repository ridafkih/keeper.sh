import { Text } from "./text";
import { Button, ButtonText } from "./button";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = "Something went wrong. Please try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <Text size="sm" tone="danger">
        {message}
      </Text>
      {onRetry && (
        <Button variant="elevated" size="compact" onClick={onRetry}>
          <ButtonText>Retry</ButtonText>
        </Button>
      )}
    </div>
  );
}
