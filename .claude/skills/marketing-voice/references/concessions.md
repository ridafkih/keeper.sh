# Concessions on comparison pages

Honest comparison is the strategy. We name what a rival does better, with a link, because that is what makes these pages citable and worth trusting. `length.md` already protects the concession from being cut. This file protects it from the opposite failure.

## The failure mode

AI-written concessions come out too generous, too long, and too persuasive for the competitor. It has recurred every time these pages were touched, and it got bad enough that reading our own comparison page made the maintainer want to switch. On the flagship page the competitor's case outweighed ours — 339 words across two sections against our 256 — and "Buy CalendarBridge if you are regulated" was the first H2 on the page.

The defect is never the honesty. It is placement, weight and voice:

- **Placement.** The concession lands before our case, so it frames everything after it
- **Weight.** It runs as long as our own section, and equal length reads as equal merit
- **Voice.** It uses advocacy verbs for the rival — "Buy CalendarBridge", "the correct tool" — which is us actively selling for them
- **Elaboration.** Each concession grows a second sentence explaining why the rival's feature is good

## Hard limits

- **Exactly one concession section per page.** A "buy them if" section plus a "where they fit better" section is two; merge them
- **It comes after our own case.** Never before it, and never as the first H2. A reader must know why we are worth considering before reading why we might not be
- **At most half the words of our own section, and no more bullets.** The fix runs in one direction: shrink theirs, never ours. Our section keeps its length and its specificity
- **One sentence per concession.** Name the fact and who it matters to, then stop. No second sentence selling it
- **State their strengths flatly, in the third person.** What they have that we do not, as fact rather than recommendation

## Banned constructions

Never aimed at a competitor, anywhere on the page:

- "buy X", "pick X", "choose X", "go with X"
- "the correct tool", "the right answer"
- "you want X", "you should" pointed at their product

"Pick Keeper.sh if…" is fine. "Pick CalendarBridge if…" is us closing their sale.

## Worked example

Before — 104 words, the first H2 on the page, advocacy voice:

> ## Buy CalendarBridge if you are regulated
>
> One decision settles this page before the rest of it. If your work needs a signed HIPAA business associate agreement, CalendarBridge offers one on its Premium and Pro plans and states it has been HIPAA compliant since 2022. Keeper.sh does not offer a BAA today.
>
> The same goes for government work. CalendarBridge supports Microsoft 365 Government Community Cloud High, which Keeper.sh has no support for today.
>
> Both of those are paperwork about somebody else's cloud, which is the trade. Buy the paperwork if a compliance officer is going to ask for it. Everything below is for the reader who is not in that position.

After — the same two facts, one line in the single concession section, placed after our case:

> **Regulated work.** CalendarBridge signs a HIPAA business associate agreement on Premium and Pro, and supports Microsoft 365 GCC High. Keeper.sh does neither today.

Nothing true was lost. The reader who needs a BAA still learns it in one line. The reader who does not is no longer told to go and buy one.

## What never gets cut

This is compression, not censorship. A rival's real advantage — a HIPAA BAA, mobile apps, booking pages, a signed DPA — stays on the page, because deleting it is the day these pages stop being citable. It just stops being sold. If a rival's claim looks wrong, flag it; never silently change a number.

## The checker

```
bun .claude/skills/marketing-voice/scripts/concession-balance.ts <file...>
```

It finds the Keeper.sh strength section and the concession section by heading, reports both word counts, bullet counts and the ratio, and exits non-zero when the concession runs over half our section, carries more bullets, appears before our case, is duplicated, or an advocacy construction targets a competitor. The two verdict phrases are flagged wherever they appear, whoever they point at. It cannot judge "you want" or "you should" — read for those by hand.

Run it on every edit to a comparison page, before and after. The recurrence this file exists to stop happens one well-meaning elaboration at a time, and each one reads reasonable on its own.
