"use client";

import dynamic from "next/dynamic";
import { ArrowDown, Ampersand, Filter, Copy as CopyIcon } from "lucide-react";
import {
  Heading1,
  Heading2,
  List,
  ListItemAdd,
  Copy,
  Select,
  Input,
  FormField,
  IconButton,
  SectionHeader
} from "@keeper.sh/ui";
import type { FilterType } from "./types";
import { MOCK_SOURCES, MOCK_DESTINATIONS } from "./utils/mock-data";
import { SourceItem } from "./components/source-item";
import { DestinationItem } from "./components/destination-item";
import { FilterItem } from "./components/filter-item";
import { useCalendarsState } from "./hooks/use-calendars-state";

const AddSourceModal = dynamic(
  () => import("@keeper.sh/ui").then((m) => ({ default: m.AddSourceModal })),
  { ssr: false }
);

const Modal = dynamic(
  () => import("@keeper.sh/ui").then((m) => ({ default: m.Modal })),
  { ssr: false }
);

const ModalHeader = dynamic(
  () => import("@keeper.sh/ui").then((m) => ({ default: m.ModalHeader })),
  { ssr: false }
);

const ModalContent = dynamic(
  () => import("@keeper.sh/ui").then((m) => ({ default: m.ModalContent })),
  { ssr: false }
);

const ModalFooter = dynamic(
  () => import("@keeper.sh/ui").then((m) => ({ default: m.ModalFooter })),
  { ssr: false }
);

const ICAL_LINK = "https://keeper.sh/ical/u/abc123def456/filtered";

const CalendarsPage = () => {
  const { state, actions } = useCalendarsState();

  const handleRemoveFilter = (id: string) => {
    actions.removeFilter(id);
  };

  const handleEditFilter = (id: string) => {
    const filter = state.filters.find((f) => f.id === id);
    if (filter) {
      actions.editFilter(id, filter);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(ICAL_LINK);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="md:hidden">
        <Heading1>Calendars</Heading1>
      </div>
      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Sources"
          description="Calendars for which events may be sourced, these events are pooled and can be used to push events to destinations."
        />
        <List>
          {MOCK_SOURCES.map((source) => (
            <SourceItem key={source.id} source={source} />
          ))}
          <ListItemAdd onClick={actions.openAddSource}>Add source</ListItemAdd>
        </List>
      </div>

      <Filter size={20} className="text-foreground-disabled mx-auto" />

      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Filters"
          description="Define rules to filter events from your sources. Only events matching these criteria will be synced to your destinations."
        />
        <List>
          {state.filters.map((filter) => (
            <FilterItem
              key={filter.id}
              filter={filter}
              onEdit={handleEditFilter}
              onRemove={handleRemoveFilter}
            />
          ))}
          <ListItemAdd onClick={actions.addFilter}>Add filter</ListItemAdd>
        </List>
      </div>

      <ArrowDown size={20} className="text-foreground-disabled mx-auto" />

      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Destinations"
          description="When events are pulled from sources, they can be pushed to destinations. Destinations require special permissions to write events to."
        />
        <List>
          {MOCK_DESTINATIONS.map((destination) => (
            <DestinationItem key={destination.id} destination={destination} />
          ))}
          <ListItemAdd>Add destination</ListItemAdd>
        </List>
      </div>

      <Ampersand size={20} className="text-foreground-disabled mx-auto" />

      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Aggregate iCal Link"
          description="A single iCal link that aggregates all filtered events from your sources."
        />
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <Input
              type="text"
              value={ICAL_LINK}
              readOnly
              className="font-mono text-xs"
            />
          </div>
          <IconButton
            icon={CopyIcon}
            onClick={handleCopyLink}
            variant="outline"
            aria-label="Copy iCal link"
          />
        </div>
      </div>

      <AddSourceModal open={state.addSourceOpen} onClose={actions.closeAddSource} />

      <Modal open={state.filterModalOpen} onClose={actions.closeFilterModal}>
        <form onSubmit={(e) => { e.preventDefault(); actions.saveFilter(); }}>
          <ModalHeader
            title={state.editingFilterId ? "Edit Filter" : "Add Filter"}
            description="Configure the filter criteria for your events"
            onClose={actions.closeFilterModal}
          />
          <ModalContent>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Filter Type</label>
              <Select
                value={state.filterType}
                onChange={(event) => actions.setFilterType(event.target.value as FilterType)}
              >
                <option value="contains">Event summary contains</option>
                <option value="does_not_contain">Event summary does not contain</option>
                <option value="starts_before">Event starts before</option>
                <option value="starts_after">Event starts after</option>
                <option value="ends_before">Event ends before</option>
                <option value="ends_after">Event ends after</option>
                <option value="is_on_weekends">Event is on weekends</option>
                <option value="is_on_weekdays">Event is on weekdays</option>
              </Select>
            </div>

            {state.filterType !== "is_on_weekends" && state.filterType !== "is_on_weekdays" && (
              <>
                {(state.filterType === "contains" || state.filterType === "does_not_contain") ? (
                  <FormField
                    label="Value"
                    type="text"
                    value={state.filterValue}
                    onChange={(event) => actions.setFilterValue(event.target.value)}
                    placeholder="Enter text..."
                  />
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-foreground">Time</label>
                      <div className="flex gap-2">
                        <Input
                          type="time"
                          value={state.timeValue}
                          onChange={(event) => actions.setTimeValue(event.target.value)}
                          className="flex-1"
                        />
                        <Select
                          value={state.timePeriod}
                          onChange={(event) => actions.setTimePeriod(event.target.value as "AM" | "PM")}
                          className="w-24"
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-foreground">Timezone</label>
                      <Select
                        value={state.timezone}
                        onChange={(event) => actions.setTimezone(event.target.value)}
                      >
                        <option value="EST">EST</option>
                        <option value="CST">CST</option>
                        <option value="MST">MST</option>
                        <option value="PST">PST</option>
                        <option value="UTC">UTC</option>
                      </Select>
                    </div>
                  </>
                )}
              </>
            )}
          </ModalContent>
          <ModalFooter
            onCancel={actions.closeFilterModal}
            onConfirm={actions.saveFilter}
            cancelText="Cancel"
            confirmText={state.editingFilterId ? "Save" : "Add"}
            isForm
          />
        </form>
      </Modal>
    </div>
  );
};

export default CalendarsPage;
