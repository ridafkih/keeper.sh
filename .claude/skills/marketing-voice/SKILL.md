---
name: marketing-voice
description: Keeper.sh house writing voice for anything a customer reads — the marketing site, pricing and feature pages, comparison pages, blog posts, how-to guides, changelog entries, and app copy. Use when writing or editing that content, or when reviewing a pull request that changes it. Enforces plain language over protocol jargon, defines which technical terms are banned, glossed, or allowed, and sets three registers so engineering depth survives where it belongs.
---

# Keeper.sh marketing voice

Our copy has consistently read as though it were written for someone who has read our source code. It is not. This skill exists to fix that without flattening the technical writing that earns us credibility.

## Who is reading

A person with two calendars and a scheduling problem. They use Google Calendar or Outlook daily. They have never heard the words ICS, iCalendar, CalDAV, OAuth, webhook, or sync token, and they will not learn them for us. They do not know that "subscribe to a calendar" and "sync a calendar" are different things — that confusion is usually why they are reading.

Assume they know: what a calendar is, what an event is, what "busy" means, what an account is, what a password is, what an app asking for permission looks like.

Assume they do not know: that calendars are separate systems, that any protocol exists, that "one-way" is a category, or that their calendar app has a refresh interval at all.

## Pick a register before the first sentence

**Register A — marketing and how-to.** The homepage, `/features`, `/pricing`, `/compare`, and the `sync-X-with-Y` guides. Median sentence 12–15 words. Every rule below applies.

**Register B — self-hosting and operator content.** Docker, environment variables, reverse proxies, the Radicale and Nextcloud guides. The reader runs containers and reads env vars, so `BLOCK_PRIVATE_RESOLUTION` and htpasswd belong here unglossed. Vocabulary changes; sentence discipline does not. Symptom-first failure modes and question-shaped headings still apply.

**Register C — the engineering explainer.** `how-calendar-sync-actually-works.mdx` and anything like it. Stays exactly as technical as it is. `410 GONE`, `RECURRENCE-ID`, `VTIMEZONE`, wall-clock expansion across DST all keep their real names. This is the credibility artifact that makes our honesty elsewhere believable — flattening it would cost more than it gains.

Register A explains what happens. Register C explains why it was hard. Register C may assume the reader has built something; it may never assume the reader has read our source.

## Rules

**1. The first sentence names the reader's situation or answers the title's question.** Never what Keeper is, never how it works internally.

> Before: "I have four calendars spread across providers:"
> After: "I was double-booking myself about once a week. My work meetings lived in Google, my personal appointments in iCloud, and neither one had any idea the other existed."

**2. Say what the reader sees, then name the mechanism — never the reverse.**

> Before: "Events are pulled from every source you connect, then pushed to every destination you map them to."
> After: "Change an event on one calendar and the copy on the other changes too. Delete it, and the copy disappears."

**3. Never state an interval, limit, or number without stating what it costs the reader.**

> Before: "Free covers 2 linked accounts, 3 sync mappings, and syncing every 30 minutes."
> After: "Free covers 2 calendar accounts and 3 connections between calendars, updating every 30 minutes — fine if you're blocking out evenings, too slow if people book you through Calendly."

**4. Rename internal concepts after what the user does with them.** "Source", "destination" and "mapping" are our data model, not the reader's vocabulary. A mapping is a **connection**. Two-way is two connections.

**5. Cut the architecture name; keep the promise it makes.** "Pull-compare-push" and "generation counter" belong in Register C and the README. Redis is our problem, not the reader's.

**6. Explain a credential by what it protects, not by what it is.**

> Before: "You need an app-specific password, which is a 16-character credential scoped to one application and revocable on its own."
> After: "Apple won't let outside apps sign in with your normal Apple password — that one opens your photos, your purchases and Find My. Instead you generate a separate password just for Keeper, which only reaches your calendar and can be cancelled on its own."

**7. Failure modes lead with the symptom the reader would actually observe.**

> Before: "Keeper will not materialise a series expanding past ten thousand occurrences within the two-year window, and that check currently fails the whole calendar's ingestion."
> After: "**One bad repeating event can freeze a whole calendar.** If a calendar just stops updating — not one missing event, everything — this is the usual cause."

**8. Keep sentences under 25 words in Registers A and B. Aim for a 12–15 word median.** Paragraphs of three sentences or fewer.

**9. Attach a person to every capability.** A freelancer with three client calendars, a parent with a school timetable, a contractor booked through Calendly. Not "users can configure per-destination display settings".

**10. One product name, one voice.** **Keeper** in body prose. **keeper.sh** only for the hosted service as distinct from self-hosting. Second person throughout. First-person "I" only in signed founder posts.

## Glossary

**Avoid** — do not use in Register A at all. **Gloss** — usable once explained, then reusable on that page. **Keep** — usable bare.

| Term | | Use instead |
|---|---|---|
| ICS / iCal link | Gloss | "a calendar link you can subscribe to". For behaviour: "a read-only feed — you can see those events, but nothing you do can change them." |
| iCalendar (the format) | Avoid | Constantly misread as Apple's iCal app. "The standard calendar file format", if at all. |
| CalDAV | Gloss | Lead with providers: "Works with Google, Outlook, iCloud, Fastmail — and any other calendar that uses the CalDAV standard." |
| OAuth | Gloss | "You sign in through Google's own permission screen. Keeper never sees your password." Only where trust is the subject; otherwise "sign in with Google". |
| App-specific password | Keep | Apple's own UI uses this label. Always gloss on first use per page. |
| Sync token / delta link | Avoid | "Google tells Keeper only what changed since last time, so checking is fast even on a huge calendar." Never name both mechanisms — the reader does not care that Microsoft calls it something else. |
| Incremental sync | Avoid | "Keeper only fetches what changed." |
| Source / destination | Avoid | Direction verbs: the calendar events come *from*, the calendar they're copied *to*. Quote the UI in bold where it uses the words. |
| Mapping | Avoid | **Connection.** This is our worst vocabulary leak — it appears in a pricing limit the reader must reason about before paying. |
| One-way / two-way | Keep | Define by behaviour on first use, every page. |
| Push / pull / ingest / reconcile / propagate / orphan events | Avoid | "reads", "copies", "updates", "leftover events". |
| Webhook / polling | Avoid | "Keeper checks on a timer rather than being pinged the moment something changes" — then the consequence. |
| AGPL-3.0 | Keep on /pricing and /compare | Hero: "open-source, and yours to self-host." |
| REST API / MCP / bearer token | Keep | Confine to a clearly labelled "For developers" section so a non-technical reader can skip the block rather than concluding the product is not for them. |
| Sync window | Gloss | "Keeper looks at events from a week ago to two years ahead. A one-off event further out than that isn't copied." |

## Formatting

Headings are the reader's question — "Can my employer see my personal event details?" — not the system's nouns. Bold works as a mini-heading inside prose, one clause followed by the explanation, not as emphasis. Tables carry a consequence column, not just a data column. Numbered steps are literal UI actions, one thing each, no concepts. Prose is for judgement; the moment there is a trade-off to weigh, stop using a table.

## Limitations

Name the limit flatly, say who it hurts, say who it doesn't, stop. No "however", no "that said, we're working on it".

> "Free updates every 30 minutes. If you're mirroring a work calendar so evenings look blocked, that changes nothing. If people book you through a scheduling link, it's too slow. Don't pay for speed you won't notice."

Being straight about our own weaknesses is a genuine strength and predates this guide. Keep it. Just lead with the symptom.

## Before publishing

1. Does the first sentence describe the reader's situation or answer the title's question?
2. Do the first 40 words contain any unglossed term from the Avoid or Gloss rows?
3. Is the median sentence under 16 words? Any sentence over 30?
4. Any paragraph longer than three sentences?
5. Does every number sit next to what it means for the reader?
6. Is every heading a question or a plain outcome?
7. Does at least one named, specific scenario appear?
8. Do limitations say what the reader would observe, before what Keeper does?
9. Is there a sentence only someone who has read our source could parse?
10. Have you written "mapping", "source", "destination", "ingest", "reconcile", or "propagate"?

## Hosted first, self-hosting as the alternative

Blog posts and guides are marketing material, not neutral documentation. The happy path in a guide is hosted keeper.sh — that is the default the reader should fall into without thinking about it.

Self-hosting still gets presented properly, as a real alternative for readers who are technically inclined or interested. Give it its own signposted section rather than interleaving both paths step by step, so a non-technical reader never has to work out which half of a numbered list applies to them. Describe it honestly, including what it costs: a server, a domain, updates, backups, and being the person who gets paged when it stops.

Do not frame self-hosting as inferior or as a downgrade. Being genuinely open-source with every Pro feature included when self-hosted is a real differentiator that competitors concede in writing, and grudging it would cost us credibility with exactly the audience that amplifies the project.

Register B content — Docker, environment variables, operator guides — is written for self-hosters by nature and needs no hosted nudge.

## Accuracy is part of voice

Rewriting copy is when a wrong claim gets restated more confidently. Every claim must be defensible from the code. Two that have already shipped wrong: we do not do two-way sync (mappings are strictly one-directional), and there is no per-account calendar limit. Check the source before you write the sentence, and if you cannot verify it, leave it out.
