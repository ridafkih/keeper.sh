import type { PropsWithChildren } from "react";
import { Text } from "@/components/ui/primitives/text";
import { TESTIMONIAL_SOURCE_LABELS, type Testimonial } from "../testimonials";

export function MarketingTestimonialsSection({ children, id }: PropsWithChildren<{ id?: string }>) {
  return <section id={id} className="w-full pt-16 pb-4">{children}</section>;
}

export function MarketingTestimonialsGrid({ children }: PropsWithChildren) {
  return (
    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px border border-interactive-border rounded-2xl overflow-hidden bg-interactive-border">
      {children}
    </div>
  );
}

export function MarketingTestimonialCard({ quote, author, handle, source }: Testimonial) {
  const attribution = handle
    ? `${handle} · ${TESTIMONIAL_SOURCE_LABELS[source]}`
    : TESTIMONIAL_SOURCE_LABELS[source];

  return (
    <figure className="flex flex-col gap-4 h-full bg-background p-6">
      <Text as="p" size="sm" align="left">{quote}</Text>
      <figcaption className="mt-auto flex flex-col">
        <Text as="span" size="sm" tone="default" align="left">{author}</Text>
        <Text as="span" size="xs" align="left">{attribution}</Text>
      </figcaption>
    </figure>
  );
}
