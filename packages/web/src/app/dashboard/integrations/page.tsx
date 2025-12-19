import Image from "next/image";
import { Button } from "@base-ui-components/react/button";
import {
  button,
  integrationCard,
  integrationIcon,
  integrationInfo,
  integrationName,
  integrationDescription,
} from "@/styles";

const integrations = [
  {
    id: "google",
    name: "Google Calendar",
    description: "Sync events from your Google Calendar",
    icon: "/integrations/icon-google.svg",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Sync events from your Outlook calendar",
    icon: "/integrations/icon-outlook.svg",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="flex-1 flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-gray-900">Integrations</h1>
      <div className="flex flex-col gap-1.5">
        {integrations.map((integration) => (
          <div key={integration.id} className={integrationCard()}>
            <div className={integrationIcon()}>
              <Image
                src={integration.icon}
                alt={integration.name}
                width={20}
                height={20}
              />
            </div>
            <div className={integrationInfo()}>
              <div className={integrationName()}>{integration.name}</div>
              <div className={integrationDescription()}>{integration.description}</div>
            </div>
            <Button className={button({ variant: "secondary" })}>Connect</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
