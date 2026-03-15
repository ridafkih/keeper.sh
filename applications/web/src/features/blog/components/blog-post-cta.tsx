import { ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";

export function BlogPostCta() {
  return (
    <aside className="overflow-hidden rounded-2xl border border-interactive-border bg-background-elevated">
      <div className="grid grid-cols-1 sm:grid-cols-3 sm:items-stretch">
        <div className="flex flex-col gap-3 p-5 md:p-6 sm:col-span-2">
          <Heading3 as="h2" className="mb-0 mt-0">
            Ready to sync your calendars?
          </Heading3>
          <Text size="base" tone="muted" className="leading-6">
            Create an account, connect your sources and destinations, and keep your availability aligned everywhere.
          </Text>
          <LinkButton size="compact" to="/register" variant="highlight">
            <ButtonText>Register for Keeper.sh</ButtonText>
          </LinkButton>
        </div>
        <div
          aria-hidden="true"
          className="hidden min-h-32 border-l border-interactive-border bg-background sm:block"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent 0 14px, var(--color-illustration-stripe) 14px 15px)",
          }}
        />
      </div>
    </aside>
  );
}
