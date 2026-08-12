import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { LinkButton, ButtonText } from "@/components/ui/primitives/button";

export function NotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-2 gap-3">
      <meta name="robots" content="noindex" />
      <Heading2>Page not found</Heading2>
      <Text size="sm" tone="muted">
        The page you're looking for doesn't exist.
      </Text>
      <LinkButton to="/" variant="border" size="compact">
        <ButtonText>Go home</ButtonText>
      </LinkButton>
    </div>
  );
}
