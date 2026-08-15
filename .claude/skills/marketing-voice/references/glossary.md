# Glossary

Every decision below has a reason attached. Read the reason, not just the verdict — most of the terms you will actually hit are not on this list, and the reason is what generalises.

The three reasons a term fails, in order of how often they bite us:

1. **It names our machinery.** The reader is being asked to learn our data model to buy our product. Rename after what the reader does with the thing.
2. **It names a protocol.** The reader picked their calendar, not their protocol. Lead with the provider names they recognise and let the standard be a trailing clause, if it appears at all.
3. **It is a number with no consequence.** A limit the reader cannot convert into "does this affect me" is not information, it is a hurdle.

Tier 1 terms are an automatic rewrite in Register A — no gloss rescues them, because glossing our own internals still leaves the reader carrying vocabulary they will never use again. Tier 2 terms are usable once explained, and reusable bare for the rest of that page. Tier 3 terms are usable as-is.

`scripts/readability.ts` parses the Tier 1 table and the allowed-phrase list below, so a row added here is enforced on the next run. Keep the first column to plain terms, one per slash-separated entry, with all commentary in the other columns.

## Tier 1 — auto-fail in Register A

| Term | Why it fails | Use instead |
|---|---|---|
| mapping | Our worst vocabulary leak. It appears in a pricing limit the reader must reason about before paying, and there is no way to guess what one is | **Connection.** Two-way is two connections |
| source | Names the reader's calendar by the role it plays in our pipeline | Direction verbs: the calendar the events come *from*. Quote the UI in bold where it uses the word |
| destination | Same pipeline role, same problem | The calendar they are copied *to* |
| ingest / ingestion | Engine verb. Describes what our worker does, not what the reader sees | "reads", "checks" |
| reconcile / reconciled / reconciling / reconciliation | Engine verb, and the passive voice it invites hides who is doing what | "fixes the difference", or name the observable outcome |
| propagate / propagated / propagating / propagation | Engine verb for something the reader experiences as "it changed on the other calendar too" | "copies", "updates" |
| aggregate / aggregated / aggregating / aggregation | Engine verb. Also inherently vague — the reader cannot picture it | "one calendar with everything in it" |
| push / pushed / pushing | Direction of data flow inside our system, invisible to the reader | "copies", "adds" |
| pull / pulled / pulling | Same | "reads", "fetches" if you must, "checks" usually |
| orphan event | Our name for a bug class. Marketing the absence of a bug the reader has never heard of just teaches them to fear it | "leftover events" |
| sync token / delta link | Two vendors' names for the same optimisation. The reader cares about the consequence, never the mechanism, and naming both doubles the cost for zero gain | "Google tells Keeper.sh only what changed since last time, so checking is fast even on a huge calendar" |
| incremental sync | Names the optimisation rather than its effect | "Keeper.sh only fetches what changed" |
| webhook / polling | A pair of architecture choices. The reader only needs the one consequence that follows | "Keeper.sh checks on a timer rather than being pinged the moment something changes" — then the consequence |
| iCalendar | Constantly misread as Apple's iCal app, so it actively creates a wrong belief | "The standard calendar file format", if at all |
| pull-compare-push / generation counter | Architecture names. They belong in Register C and the README | Cut the name, keep the promise it makes |

## Allowed phrases

Phrases that contain a Tier 1 word but are correct as written. The checker blanks these before scanning.

- open source
- open-source
- open-sourced
- open sourced
- pull request
- source code
- source available

## Tier 2 — gloss on first use, then reuse freely

| Term | Why it needs the gloss | Use instead |
|---|---|---|
| ICS / iCal link | The reader has met these links without ever learning the name, and the name carries the wrong half of the meaning — the important part is that the link is read-only | "a calendar link you can subscribe to". For behaviour: "a read-only feed — you can see those events, but nothing you do can change them." |
| CalDAV | A protocol name where the reader wants a compatibility answer. They cannot look up whether their calendar "supports CalDAV" | Lead with providers: "Works with Google, Outlook, iCloud, Fastmail — and any other calendar that uses the CalDAV standard." |
| OAuth | Only relevant when trust is the subject. Elsewhere it is a spec number attached to a button they already know how to press | "You sign in through Google's own permission screen. Keeper.sh never sees your password." Otherwise "sign in with Google" |
| app-specific password | Apple's own UI uses this label, so the reader will meet the exact words. But the label explains nothing about why it exists | Keep the term, gloss on first use per page by what it protects — see rule 6 |
| provider | Our word for a company whose calendar we talk to. The reader calls it "Google" or "my calendar" | Name the companies. Use "calendar service" only when you genuinely mean the general case |
| sync window | A number that silently decides whether the reader's event gets copied. Never state it bare | "Keeper.sh looks at events from a week ago to two years ahead. A one-off event further out than that isn't copied." |
| sync interval | A settings-field name, and a number that is meaningless without the cost — see rule 3 | "updating every 30 minutes", immediately followed by who that is fine for and who it is not |
| feed | Fine once, ambiguous when stacked. "Aggregated iCal Feed" is three unfamiliar words in a row | Say what the reader gets: "one calendar link containing everything" |
| AGPL-3.0 | A licence SKU. It earns its place on pricing and comparison pages, where the reader is weighing lock-in, and nowhere else | Hero: "open-source, and yours to self-host." Keep the licence name on `/pricing` and `/compare` |
| REST API / MCP / bearer token | Correct and useful for the audience that wants them. The failure mode is a non-technical reader hitting them mid-page and concluding the product is not for them | Keep the terms, but confine them to a clearly labelled "For developers" section that can be skipped whole |

## Tier 3 — usable bare

| Term | Why it is fine | Note |
|---|---|---|
| one-way / two-way | Everyday words, and the reader needs the distinction to understand what they are buying | Define by behaviour on first use, every page. Check the code before claiming either — mappings are strictly one-directional |
| Google Calendar / Outlook / iCloud / Fastmail | The reader's own vocabulary for the thing | Use these instead of "provider" wherever you can |
| calendar / event / account / password / permission | Assumed knowledge, per the reader description in SKILL.md | |
| Keeper.sh | The product name, and the reader's own vocabulary for it | Always in full. Bare "Keeper" is a different company's product — see "The product name" below |
| Docker / environment variable / reverse proxy | Register B vocabulary, where the reader runs containers | Auto-fail in Register A, unglossed and correct in Register B |
| 410 GONE / RECURRENCE-ID / VTIMEZONE / RRULE / DST | Register C vocabulary. Flattening these would cost more credibility than it gains | Register C only |

## Audience triggers — a placement list, not a tier

The tiers above rule on **words**. This list rules on **position**, and nothing on it is banned anywhere. Every term here is true, provable and load-bearing somewhere on the page — the failure is only ever putting it in a slot that answers "what is this and who is it for", because a reader or an answer engine takes that slot as the product's classification and stops reading. Rule 12 and the defining-position list are in `positioning.md`.

`scripts/readability.ts` parses these bullets and flags them in frontmatter `title`, `description` and `blurb`, and in the first sentence of a page or a section — and only when the sentence predicates them of Keeper.sh. A bullet added here is enforced on the next run.

- open source
- open-source
- AGPL
- self-host
- self-hosting
- your own hardware
- your own server
- own hardware
- own server
- Docker
- Postgres
- Redis
- CLI
- MCP
- REST API

Three trigger terms are deliberately **not** on the machine list, because no pattern separates the violation from the correct use:

- **CalDAV and Fastmail**, which are usually a compatibility answer a buyer wants. "Keeper.sh reaches iCloud, Fastmail and any CalDAV server too" is a defining sentence doing its job.
- **developers** and **API**, which are ordinary words outside our own copy — a competitor's developer audience, a provider's API.

Those stay a reading job, and they are question 11 in the publishing checklist.

## The product name

The product is **Keeper.sh** in every sentence a customer reads, including headings, titles, meta descriptions and alt text. There is no shortened form and no distinction between the hosted service and the self-hosted one — both are Keeper.sh, and self-hosting is described by what the reader does, not by a second name.

The reason is a collision we are already paying for. "Keeper" is a well-known password manager, which is why AlternativeTo lists us under the slug `keeper-1`. Every bare "Keeper" in a comparison page or a how-to guide hands the ambiguity back to the reader in the one place we are trying to resolve it.

Bare "Keeper" or lowercase "keeper" stands unchanged in six places, none of them prose we wrote about the product:

- Code identifiers and package names — `@keeper.sh/calendar`, `keeper-standalone`, environment variables, file paths
- The `@keeper.sh` remote UID suffix and the `"keeper.sh"` Outlook category, which are literal strings the sync engine matches on
- Verbatim quotations from third parties who wrote "Keeper". A competitor's page quoted in our copy keeps their wording
- The repository path `github.com/ridafkih/keeper.sh`
- Hostnames and URLs, where lowercase `keeper.sh` is already correct
- Anything inside a fenced code block, for the same reason as the first two

This is a reading job, not a pattern. `\bKeeper\b` matches inside "Keeper.sh" itself and inside every exemption above, so `scripts/readability.ts` deliberately does not test it — it is question 10 in the publishing checklist instead.
