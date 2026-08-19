export type HowItWorksStep = {
  title: string;
  body: string;
  note?: string;
};

// Shared by the homepage and /features so the two never drift apart on what
// setting a connection up actually involves.
export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    title: "Connect a calendar, then say where it copies to",
    body: "Connecting takes a sign-in or a pasted link. You then point that calendar at the one you want its events to land in.",
  },
  {
    title: "Choose what each calendar shows",
    body: "Copies start as a busy block named after the source calendar. Pro lets you turn the title, description and location back on, and adds filters to skip events.",
  },
  {
    title: "Keeper.sh takes it from there",
    body: "On Pro, Google and Outlook tell Keeper.sh the moment something changes, so the copy lands within seconds. Free checks every minute and copies within 30.",
    note: "Calendars you connect with a pasted link are read in full each time.",
  },
];
