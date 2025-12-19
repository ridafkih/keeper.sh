import {
  CalendarSourcesSection,
  DestinationsSection,
  ICalLinkSection,
} from "@/components/integrations-sections";

export default function IntegrationsPage() {
  return (
    <div className="flex-1 flex flex-col gap-8">
      <CalendarSourcesSection />
      <DestinationsSection />
      <ICalLinkSection />
    </div>
  );
}
