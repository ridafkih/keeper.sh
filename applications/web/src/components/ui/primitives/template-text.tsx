import { tv } from "tailwind-variants/lite";
import { parseTemplate } from "@/utils/templates";

const templateVariable = tv({
  variants: {
    state: {
      known: "text-template",
      unknown: "text-template-muted",
      disabled: "text-template-muted",
    },
  },
  defaultVariants: {
    state: "unknown",
  },
});

interface TemplateTextProps {
  template: string;
  variables: Record<string, string>;
  disabled?: boolean;
  className?: string;
}

export function TemplateText({ template, variables, disabled, className }: TemplateTextProps) {
  const segments = parseTemplate(template);

  return (
    <span className={className}>
      {segments.map((segment, i) => {
        if (segment.type === "text") {
          return <span key={i}>{segment.value}</span>;
        }

        const state = disabled ? "disabled" : segment.name in variables ? "known" : "unknown";
        return (
          <span key={i} className={templateVariable({ state })}>
            {`{{${segment.name}}}`}
          </span>
        );
      })}
    </span>
  );
}
