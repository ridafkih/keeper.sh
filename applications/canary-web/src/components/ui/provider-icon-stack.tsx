import { Text } from "./text";
import { ProviderIcon } from "./provider-icon";

interface ProviderIconStackProps {
  providers: { provider?: string; calendarType?: string }[];
  max?: number;
}

function ProviderIconStackItem({ provider, calendarType }: { provider?: string; calendarType?: string }) {
  return (
    <div className="size-6 rounded-full bg-background-elevated border border-border-elevated flex items-center justify-center">
      <ProviderIcon provider={provider} calendarType={calendarType} size={12} />
    </div>
  );
}

function ProviderIconStack({ providers, max = 4 }: ProviderIconStackProps) {
  const visible = providers.slice(0, max);
  const overflow = providers.length - max;

  return (
    <div className="relative">
      <div className="absolute right-0 inset-y-0 flex items-center *:not-last:-mr-2.5">
        {visible.map((entry, index) => (
          <ProviderIconStackItem key={index} provider={entry.provider} calendarType={entry.calendarType} />
        ))}
        {overflow > 0 && (
          <div className="size-6 rounded-full bg-background-elevated border border-border-elevated flex items-center justify-center">
            <Text size="xs" tone="muted" className="tabular-nums text-[0.625rem]">+{overflow}</Text>
          </div>
        )}
      </div>
    </div>
  );
}

export { ProviderIconStack };
