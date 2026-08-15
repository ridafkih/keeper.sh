# Before and after

Every "before" here is copy we actually shipped. Nothing is invented, and nothing is a strawman — this is what our marketing reads like when nobody is holding the rules.

Read the transformation notes, not just the after. The notes are the operation; the after is only one output of it.

---

## 1. Feature card — engine verbs in a product benefit

Source: `applications/web/src/routes/(marketing)/index.tsx`, `MARKETING_FEATURES`

**Before**

> Simple Synchronization Engine
>
> Your events are aggregated and synced across all linked calendars. Discrepancies are reconciled. Built to prevent orphan events.

**After**

> Every calendar knows what the others are doing
>
> Book a dentist appointment in your personal calendar and the slot goes busy on your work one. Change the time and both change. It happens on a timer, without you thinking about it.

**Transformation notes**

- Heading was a component of our system ("Synchronization Engine") → heading is now the outcome the reader wanted
- "aggregated" → deleted; the reader experiences a result, not a gathering step (Tier 1)
- "Discrepancies are reconciled" → shown as the observable event: change the time and both change (Tier 1, and passive voice hiding the actor)
- "orphan events" → deleted entirely; we were advertising the absence of a bug the reader has never heard of, which only plants the fear (Tier 1)
- "linked calendars" → a named, concrete pair (personal and work)
- Added the mechanism last and in plain words ("on a timer"), per rule 2

---

## 2. Feature card — three acronyms inside a claim of simplicity

Source: `index.tsx`, `MARKETING_FEATURES`

**Before**

> Link OAuth, ICS or CalDAV accounts in seconds. No complicated configuration or technical knowledge required. Connect and go.

**After**

> Sign in to Google, Outlook or iCloud and Keeper.sh is connected. If your calendar is somewhere else, you can paste a calendar link instead.

**Transformation notes**

- The sentence claimed no technical knowledge was required while requiring three protocol names to parse. That contradiction is the whole bug
- "OAuth" → "Sign in to", which is literally what the reader does (Tier 2, and trust is not the subject here)
- "CalDAV accounts" → the provider names the reader recognises (Tier 2)
- "ICS" → "paste a calendar link" (Tier 2)
- "No complicated configuration or technical knowledge required" → deleted; telling the reader it is easy is weaker than showing two steps
- "Connect and go" → deleted, slogan with no content

---

## 3. How it works, step 3 — three engine verbs in two sentences

Source: `index.tsx`, `HOW_IT_WORKS_STEPS`

**Before**

> Events are continuously aggregated and pushed across all your linked calendars. Conflicts are reconciled.

**After**

> Keeper.sh checks your calendars on a timer and copies anything new across. If you move an event, the copy moves with it.

**Transformation notes**

- "aggregated", "pushed", "reconciled" — three Tier 1 verbs, all passive, none describing anything the reader can see
- Passive voice → Keeper.sh as the subject, so the reader knows who is acting
- "continuously" → "on a timer", which is both truer and the thing they need to know before rule 3 bites on the pricing table
- "Conflicts are reconciled" → the specific case the reader has in mind (they moved an event)

---

## 4. FAQ — a jargon question answered with more jargon

Source: `index.tsx`, `FAQ_ITEMS`

**Before**

> Can I use ICS or iCal links as a source?
>
> Yes. Any publicly accessible ICS or iCal link can be used as a calendar source in Keeper. This means you can pull events from services that only offer read-only calendar feeds.

**After**

> My calendar only gives me a link, not a login. Does that work?
>
> Yes. Paste the link and Keeper.sh will copy those events onto your other calendars. It works one way only: you will see the events, but nothing you change in Keeper.sh reaches the original calendar.

**Transformation notes**

- Heading was a system noun question → heading is now the reader's situation, in the words they would use (rule: headings are the reader's question)
- "as a source" → deleted from both question and answer (Tier 1)
- "publicly accessible" → deleted; the reader cannot assess it, and pasting the link tests it for them
- "in Keeper" → "Keeper.sh", per rule 10, in both places the answer names the product
- "pull events" → "copy those events onto your other calendars" (Tier 1)
- "read-only calendar feeds" → the behaviour spelled out, because read-only is the entire consequence and the phrase buries it
- The one-way limitation moved from an implication to a flat statement, per the limitations rule

---

## 5. FAQ — a compatibility answer the reader cannot use

Source: `index.tsx`, `FAQ_ITEMS`

**Before**

> Keeper.sh works with Google Calendar, Microsoft Outlook, Apple iCloud, FastMail, and any provider that supports CalDAV or ICS feeds. If your calendar supports one of these protocols, it will work with Keeper.

**After**

> Keeper.sh works with Google Calendar, Microsoft Outlook, Apple iCloud and Fastmail. Beyond those, most calendars work too — if yours can give you a calendar link, or a username and password for a calendar app, you are covered.

**Transformation notes**

- The last sentence asked the reader to determine which protocols their calendar supports. They cannot answer that, so the sentence converts a yes into a maybe
- "any provider that supports CalDAV or ICS feeds" → a test the reader can actually run on their own screen (Tier 2)
- "provider" → deleted; the companies are already named (Tier 2)
- "protocols" → deleted (Tier 2)
- "it will work with Keeper" → "Keeper.sh", per rule 10; the bare name is a password manager, and the sentence that opened with the full name should not have dropped it four clauses later
- Facts preserved: the four named providers, and the CalDAV/ICS capability restated as its user-visible test

---

## 6. FAQ — 45 words and a settings-schema ending

Source: `index.tsx`, `FAQ_ITEMS`

**Before**

> Only if you want them to be. You can choose whether events display details, or just show a generic event summary. You can customize the title, and choose to hide the details you want to keep private. These are configurable per-calendar.

**After**

> Only if you want them to be. By default the copy shows as busy with no details. You can give it a title of your own — "Personal", say — and your colleagues see only that. You choose this separately for each calendar.

**Transformation notes**

- Four sentences and 41 words in one paragraph, three of them restating the same capability
- "a generic event summary" → the actual default the reader will see
- "the details you want to keep private" → a named example, per rule 9, so a person can picture their own case
- "These are configurable per-calendar" → "You choose this separately for each calendar"; second person, and no settings vocabulary
- Added the colleague, because the fear behind this question is a specific person reading a specific event

---

## 7. Pricing table — labels naming our schema

Source: `index.tsx`, `PRICING_FEATURES`

**Before**

> Sync Interval — Every 30 minutes / Every 1 minute
>
> Sync Mappings — Up to 3 / infinity
>
> Aggregated iCal Feed — check / check

**After**

> How often calendars update — Every 30 minutes / Every minute
>
> Connections between calendars — Up to 3 / Unlimited
>
> One calendar link with everything on it — Included / Included

**Transformation notes**

- "Sync Interval" → the question the row answers (Tier 2, and a config-field name)
- "Sync Mappings" → "Connections between calendars"; this is the single most damaging leak we have, because the reader has to price a unit we never defined (Tier 1)
- "Aggregated iCal Feed" → three unfamiliar words in a row, replaced with what the reader receives (Tier 1 "aggregated", Tier 2 "feed")
- "infinity" → "Unlimited"
- Rule 3 is not satisfied by the table alone. The 30-minute row still needs prose beside it saying who that is fine for and who it is too slow for — the table gets the number, the prose gets the consequence

---

## 8. Pricing intro — the business model as the subject

Source: `index.tsx`, pricing section

**Before**

> Hosted Pricing
>
> Keeper.sh uses a low-cost freemium model to give you a solid range of choice. Check the GitHub repository for self-hosting options.

**After**

> Pricing
>
> Free covers two calendar accounts and three connections between them, updating every 30 minutes — fine if you are blocking out evenings, too slow if people book you through a scheduling link. Pro is $5 a month for unlimited connections and updates every minute.
>
> Keeper.sh is open source, and you can run it yourself instead. Every Pro feature is included when you self-host — see the self-hosting guide for what that costs you in servers and upkeep.

**Transformation notes**

- "freemium model" → deleted; the reader is buying a calendar tool, not evaluating our revenue strategy
- "a solid range of choice" → the actual plans and what separates them (rule 3, every number next to what it costs the reader)
- "Hosted Pricing" → "Pricing"; the hosted/self-hosted distinction is a deployment concept and only the second paragraph needs it
- Self-hosting moved out of a trailing sentence that pointed at a GitHub repository, into its own signposted paragraph — presented as a real alternative, with its cost named, per the hosted-first section
- Facts preserved: `[FACT: 2 accounts]`, `[FACT: 3 connections]`, `[FACT: 30 minutes free]`, `[FACT: $5/month]`, `[FACT: every minute on Pro]`, `[FACT: Pro features included when self-hosted]`

---

## 9. Hero subhead — four jargon tokens in our highest-traffic sentence

Source: `index.tsx`, hero

**Before**

> All of your calendars in-sync.
>
> Synchronize events between your personal, work, business and school calendars automatically. Works with Google Calendar, Outlook, iCloud, CalDAV, and ICS/iCal feeds. Open-source under AGPL-3.0.

**After**

> Stop double-booking yourself.
>
> Keeper.sh copies your events between your personal, work and school calendars, so every one of them shows you as busy at the same times. Works with Google Calendar, Outlook, iCloud and Fastmail.

**Transformation notes**

- "All of your calendars in-sync" describes a system state → the headline now names the reader's situation, per rule 1
- "Synchronize events between" → "copies your events between", and then the consequence, per rule 2
- "CalDAV, and ICS/iCal feeds" → dropped from the hero and moved to the compatibility FAQ, where a reader who needs it will look (Tier 2)
- "Open-source under AGPL-3.0" → dropped from the hero; the licence name earns its place on `/pricing` and `/compare` (Tier 2). "Open source, and yours to self-host" is the hero-safe version if the hero needs it at all
- Facts preserved: `[FACT: Google Calendar]`, `[FACT: Outlook]`, `[FACT: iCloud]`, `[FACT: Fastmail]`. `[FACT: CalDAV]`, `[FACT: ICS]` and `[FACT: AGPL-3.0]` were dropped from this block deliberately and appear elsewhere on the page — that is a relocation, and it has to be verified as one, not assumed

---

## 10. Founder blog post — architecture where the promise belongs

Source: `applications/web/src/content/blog/introducing-keeper-blog.mdx`

**Before**

> Keeper.sh uses a pull-compare-push architecture. On each sync cycle, it pulls events from your configured source calendars, compares them against what it already knows, and pushes changes to your destination calendars.
>
> To prevent race conditions, each sync operation acquires a Redis-backed generation counter. If two syncs try to run on the same calendar at the same time, the later one backs off.

**After**

> Every few minutes Keeper.sh looks at the calendars you told it to watch, works out what changed since last time, and makes the same change on the calendars you are copying to.
>
> Two of those checks can overlap, and when they do only one of them is allowed to write. That is why you never end up with the same meeting twice.

**Transformation notes**

- "pull-compare-push architecture" → cut the name, kept the promise it makes, per rule 5 (Tier 1)
- "pulls" and "pushes" → "looks at" and "makes the same change" (Tier 1)
- "source calendars" and "destination calendars" → "the calendars you told it to watch" and "the calendars you are copying to"; direction verbs instead of pipeline roles (Tier 1)
- "Redis-backed generation counter" → deleted. Redis is our problem, not the reader's (rule 5)
- "race conditions" → the symptom the reader would have seen, per rule 7: the same meeting twice
- This is a founder post, so first-person "I" is allowed elsewhere in it — but the sync mechanism is Register A prose sitting inside a Register A post, not a Register C explainer, and it should read like one. The full version of this material belongs in `how-calendar-sync-actually-works.mdx`, where every one of these names is correct as written

---

## 11. Comparison blurb — two thirds of what we are is machinery

Source: `applications/web/src/content/blog/keeper-sh-vs-calendarbridge.mdx`, frontmatter

**Before**

> `blurb: "Keeper.sh is $5 a month however many calendars you have, runs on your own hardware, and is open source. CalendarBridge owns the regulated flank. Here is how the two differ."`

**After**

> `blurb: "Keeper.sh is $5 a month however many calendars you have, and copies your busy time without copying your event titles. CalendarBridge owns the regulated flank. Here is how the two differ."`

**Transformation notes**

- Every word of the before is true, and none of it is Tier 1. This is a placement failure, not a vocabulary one — see "Defining positions" in `positioning.md`
- Two of the three things the sentence says Keeper.sh *is* are technical, so a reader or an assistant quoting the blurb classifies us as self-hoster tooling and sends the non-technical asker to a hosted rival
- The price advantage — the thing that actually wins this page for an ordinary buyer — was buried in the middle of the three. It now leads
- "runs on your own hardware" → replaced by the default privacy behaviour, which is at least as specific and which this page proves at length. Vagueness would not have been an improvement (rule 12)
- "is open source" → demoted, not deleted. It survives at five later positions in this same file: the lede, the procurement paragraph, the "you want to read the code" verdict line, the self-hosting FAQ answer and the sources list
- Facts preserved: `[FACT: $5/month]`, `[FACT: unlimited calendars on Pro]`, `[FACT: event titles hidden by default]` — `excludeEventName` defaults to true in `packages/database/src/database/schema.ts`. `[FACT: open source]` and `[FACT: runs on your own hardware]` are relocations, and the five later positions are where they landed

---

## Fact preservation in practice

Examples 8, 9 and 10 show the three outcomes the `[FACT]` diff has to distinguish:

- **Preserved.** The claim survives in different words. Verify the meaning did not strengthen — "works with Fastmail" and "works with any Fastmail setup" are not the same claim.
- **Relocated.** The claim left this block and landed in another. You must point at where, not assume it.
- **Dropped.** The claim is gone. That needs a reason, and the reason has to be a scope decision, not an oversight.

There is no fourth category. A claim that came out stronger than it went in is an error, whether or not it is defensible from the code — and if it is not defensible from the code, it is the exact failure this skill exists to prevent.
