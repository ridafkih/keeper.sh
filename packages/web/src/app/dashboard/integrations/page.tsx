import { Suspense } from "react";
import type { ReactNode } from "react";
import {
  CalendarSourcesSection,
  DestinationsSection,
  ICalLinkSection,
} from "@/components/integrations";
import { PageContent } from "@/components/page-content";
import { SectionSkeleton } from "@/components/section-skeleton";

export default function IntegrationsPage(): ReactNode {
  return (
    <PageContent>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <CalendarSourcesSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={2} />}>
        <DestinationsSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton rows={1} />}>
        <ICalLinkSection />
      </Suspense>
    </PageContent>
  );
}
