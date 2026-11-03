# 0017. Integration lands confirmed fixes whose owners never picked them up

- Status: accepted
- Date: 2026-11-03
- Supersedes: the last sentence of 0011 rule 6 ("INTEGRATE edits no source and makes no commits"), for this audit
- Tasks: INTEGRATE (owner); recorded at wave 6

## Context and problem statement

0011 rule 6 sent every integration failure back to its owning slice through the run ledger and kept integration out of the source. Three confirmed discrepancies stayed unfixed that way: the CalDAV fixed-offset recurring series that was withheld, the Google offset-less `dateTime` that failed a whole fetch, and all-day events from the neighbouring day showing up in viewer-zone reads and counts. Their owning slices had finished and never applied the contract requests logged against them. The owner asked for every confirmed time-zone discrepancy to be found, and an audit that leaves confirmed drops and mistimings on the branch does not deliver that.

## Decision outcome

Integration may commit a source fix for a confirmed finding when its owning slice is no longer running and the contract request logged for it was not picked up. Each such fix lands as one commit that holds both the test and the fix. Its test must fail at assertion level on origin/main source and pass on the branch, it must be logged in the run ledger, and it must get its own superseding decision whenever it changes a contract (as 0016 does for 0009). Integration may also change how a test runs, never what it asserts, to clear a load-timing failure that no running slice owns. Every other rule in 0011 still stands.

This covers commits 1f7f6d81, 2309a272, bb8e00fd, b5aefed1, 4a62b8aa, 996f84cd, 4449829d and a2c912df.

### Consequences

- Good: no confirmed finding is left unfixed just because its owning slice has stopped.
- Bad: integration now writes code, so its commits need the same red-to-green proof and review as any slice's.
