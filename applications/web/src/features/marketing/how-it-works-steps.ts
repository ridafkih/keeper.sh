export type HowItWorksStep = {
  title: string;
  body: string;
  note?: string;
};

// Shared by the homepage and /features so the two never drift apart on what
// setting a sync up actually involves.
export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    title: "Connect your calendars, then set up a sync",
    body: "Connecting takes a sign-in or a pasted link. A sync then says which calendars copy into which, one way or both ways.",
  },
  {
    title: "Choose what each sync shares",
    body: "Copies start as a busy block named after the source calendar. Pro lets you turn the title, description and location back on, and adds filters to skip events.",
  },
  {
    title: "Keeper.sh takes it from there",
    body: "On Pro, Google and Outlook tell Keeper.sh the moment something changes, so the copy lands within seconds. Free checks every minute and copies within 30.",
    note: "Calendars you connect with a pasted link are read in full each time.",
  },
];
