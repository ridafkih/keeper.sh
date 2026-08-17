import type { ChangeListing, ListingScope } from "@keeper.sh/sync-protocol";

const noDiagnostics = {
  withheld: { sample: [], total: 0 },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 0,
} as const;

const cursorLostListing = (scope: ListingScope): ChangeListing => ({
  kind: "cursorLost",
  scope,
  diagnostics: noDiagnostics,
});

export { cursorLostListing };
