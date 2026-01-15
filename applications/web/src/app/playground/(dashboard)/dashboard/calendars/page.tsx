"use client";

import { ArrowDown } from "lucide-react";
import {
  Heading1,
  Heading2,
  List,
  ListItemAdd,
  Copy,
  AddSourceModal,
  Select,
  Input,
  Modal,
  ModalHeader,
  ModalContent,
  ModalFooter,
  FormField
} from "@keeper.sh/ui";
import type { FilterType } from "./types";
import { MOCK_SOURCES, MOCK_DESTINATIONS } from "./utils/mock-data";
import { SourceItem } from "./components/source-item";
import { DestinationItem } from "./components/destination-item";
import { FilterItem } from "./components/filter-item";
import { useCalendarsState } from "./hooks/use-calendars-state";

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

  return (
    <div className="flex flex-col gap-8">
      <div className="md:hidden">
        <Heading1>Calendars</Heading1>
      </div>
      <div className="flex flex-col gap-2">
        <Heading2>Sources</Heading2>
        <Copy className="text-xs">Calendars for which events may be sourced, these events are pooled and can be used to push events to destinations.</Copy>
        <List>
          {MOCK_SOURCES.map((source) => (
            <SourceItem key={source.id} source={source} />
          ))}
          <ListItemAdd onClick={actions.openAddSource}>Add source</ListItemAdd>
        </List>
      </div>

      <ArrowDown size={20} className="text-neutral-300 mx-auto" />

      <div className="flex flex-col gap-2">
        <Heading2>Filters</Heading2>
        <Copy className="text-xs">Define rules to filter events from your sources. Only events matching these criteria will be synced to your destinations.</Copy>
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

      <ArrowDown size={20} className="text-neutral-300 mx-auto" />

      <div className="flex flex-col gap-2">
        <Heading2>Destinations</Heading2>
        <Copy className="text-xs">When events are pulled from sources, they can be pushed to destinations. Destinations require special permissions to write events to.</Copy>
        <List>
          {MOCK_DESTINATIONS.map((destination) => (
            <DestinationItem key={destination.id} destination={destination} />
          ))}
          <ListItemAdd>Add destination</ListItemAdd>
        </List>
      </div>

      <AddSourceModal open={state.addSourceOpen} onClose={actions.closeAddSource} />

      <Modal open={state.filterModalOpen} onClose={actions.closeFilterModal}>
        <ModalHeader
          title={state.editingFilterId ? "Edit Filter" : "Add Filter"}
          description="Configure the filter criteria for your events"
          onClose={actions.closeFilterModal}
        />
        <ModalContent>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-neutral-700">Filter Type</label>
            <Select
              value={state.filterType}
              onChange={(e) => actions.setFilterType(e.target.value as FilterType)}
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
                  onChange={(e) => actions.setFilterValue(e.target.value)}
                  placeholder="Enter text..."
                />
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-neutral-700">Time</label>
                    <div className="flex gap-2">
                      <Input
                        type="time"
                        value={state.timeValue}
                        onChange={(e) => actions.setTimeValue(e.target.value)}
                        className="flex-1"
                      />
                      <Select
                        value={state.timePeriod}
                        onChange={(e) => actions.setTimePeriod(e.target.value as "AM" | "PM")}
                        className="w-24"
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-neutral-700">Timezone</label>
                    <Select
                      value={state.timezone}
                      onChange={(e) => actions.setTimezone(e.target.value)}
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
        />
      </Modal>
    </div>
  );
};

export default CalendarsPage;
