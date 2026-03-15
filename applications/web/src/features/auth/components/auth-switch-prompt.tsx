import type { PropsWithChildren } from "react";
import { Text } from "../../../components/ui/primitives/text";

export function AuthSwitchPrompt({ children }: PropsWithChildren) {
  return (
    <Text size="sm" tone="muted" align="center">
      {children}
    </Text>
  );
}
