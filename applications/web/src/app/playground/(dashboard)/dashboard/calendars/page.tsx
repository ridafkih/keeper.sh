import { Scaffold } from "../../../components/scaffold";
import { Heading2, Heading3 } from "../../../components/heading";
import { Copy } from "../../../components/copy";
import {
  List,
  ListItem,
  ListItemLabel,
  ListItemValue,
  ListItemAdd,
} from "../../../components/list";

const sources = [
  { id: "1", name: "Personal", account: "john@gmail.com" },
  { id: "2", name: "Work", account: "john@gmail.com" },
  { id: "3", name: "Birthdays", account: "john@gmail.com" },
  { id: "4", name: "Calendar", account: "john@work.com" },
  { id: "5", name: "Default", account: "me@fastmail.com" },
];

const destinations = [
  { id: "1", name: "Work Calendar", account: "sync.example.com" },
  { id: "2", name: "Personal Master", account: "personal.example.com" },
];

const CalendarsPage = () => (
  <Scaffold className="py-8">
    <div className="flex flex-col gap-4">
      <Heading2>Calendars</Heading2>
      <Copy>Manage your calendar sources and destinations.</Copy>
      <Heading3>Sources</Heading3>
      <List>
        {sources.map((source) => (
          <ListItem key={source.id}>
            <ListItemLabel>{source.name}</ListItemLabel>
            <ListItemValue>{source.account}</ListItemValue>
          </ListItem>
        ))}
        <ListItemAdd>Add calendar</ListItemAdd>
      </List>
      <Heading3>Destinations</Heading3>
      <List>
        {destinations.map((destination) => (
          <ListItem key={destination.id}>
            <ListItemLabel>{destination.name}</ListItemLabel>
            <ListItemValue>{destination.account}</ListItemValue>
          </ListItem>
        ))}
        <ListItemAdd>Add destination</ListItemAdd>
      </List>
    </div>
  </Scaffold>
);

export default CalendarsPage;
