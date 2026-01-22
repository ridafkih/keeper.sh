export type Feature = {
  id: number
  title: string
  description: string
  gridClasses: string
}

export const features: Feature[] = [
  {
    id: 1,
    title: "Universal Calendar Sync",
    description: "Connect Google, Outlook, Apple Calendar and more. Keep all your calendars perfectly in sync.",
    gridClasses: "lg:col-start-1 lg:col-span-4 lg:row-start-1 border-border border-b sm:border-r"
  },
  {
    id: 2,
    title: "Privacy-First & Open Source",
    description: "Built with AGPL-3.0 license. Your calendar data stays private, secure, and under your control. Community-driven development you can trust.",
    gridClasses: "lg:col-start-5 lg:col-span-6 lg:row-start-1 border-border border-b"
  },
  {
    id: 3,
    title: "Real-Time Synchronization",
    description: "Events sync instantly across all connected calendars. Update once, see everywhere. Never miss a change or double-book again.",
    gridClasses: "lg:col-start-1 lg:col-span-6 lg:row-start-2 border-border border-b sm:border-b-0 sm:border-r"
  },
  {
    id: 4,
    title: "Set Up in Minutes",
    description: "Simple OAuth connections and intuitive sync rules. No complex configuration needed.",
    gridClasses: "lg:col-start-7 lg:col-span-4 lg:row-start-2 border-border"
  }
]
