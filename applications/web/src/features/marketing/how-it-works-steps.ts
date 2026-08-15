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
    body: "You set this per calendar. One can carry the full title, description and location while another shows a plain block. Pro adds filters to skip events.",
  },
  {
    title: "Keeper.sh takes it from there",
    body: "Your calendars are read every minute on both plans. A change reaches your other calendars within 30 minutes on Free, and within a minute on Pro.",
    note: "Calendars you connect with a pasted link are read in full each time.",
  },
];
