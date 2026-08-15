# Where open source sits

Our rule — open source, AGPL, self-hosting, Docker, CalDAV and API never sit in a defining
position — was derived from our own mistakes. This file checks it against companies that
already solved the problem, surface by surface, with the exact wording and where it sat.

The anchor is **cal.com**: open source, calendar category, hosted commercial product plus
self-host, the closest comparator that exists. Triangulated with **Plausible** (privacy-first
*and* open source — our exact promise/proof pair), **Bitwarden** (open source against a
proprietary incumbent, at enterprise scale), **PostHog** (the loudest open-source voice in its
category, and the likeliest counter-example) and **Ghost** (open source sold to writers who do
not code — the audience furthest from a licence).

Every quote below is from the live page or a dated archive snapshot, fetched August 2026.

## What the five do with each defining position

| Position | cal.com | Plausible | Bitwarden | PostHog | Ghost |
|---|---|---|---|---|---|
| `<title>` | no | no | no | no | **yes** |
| meta description | no | **yes** | no | no | no |
| H1 | no | no | no | no | no |
| Hero subhead | no | no | no | no | no |
| First sentence | no | no | no | no | no |
| Nav label | no | no | no | no | no |
| Above-fold CTA | no | no | no | no | no |
| Comparison page title | no | no | no | no | no |
| Comparison verdict | no | no | **yes** | no | no |
| Structured-data `description` | none published | **yes** | none published | none published | no |
| `llms.txt` opening | no | none published | **yes** | no | none published |

Six positions are unanimous across all five: **H1, hero subhead, first sentence, nav, CTA, and
comparison page title.** Nobody puts the licence there. The other five are contested one-for-
five, and every contested case has a reason worth learning. That asymmetry is the real finding,
and our rule currently flattens it.

## The pattern

### 1. The unanimous six are absolute

Cal.com's homepage carries no licence language of any kind:

> `<title>` — **Cal.com | Scheduling Software for Online Bookings**
> `<meta name="description">` — **A fully customizable scheduling software for individuals,
> businesses taking calls and developers building scheduling platforms where users meet users.**
> `<h1>` — **The better way to schedule your meetings**

The strings `open source`, `open-source` and `AGPL` appear **zero times** in 2.3 MB of homepage
HTML. PostHog's homepage returns **zero** hits for the same search across 1.4 MB. Ghost's H1 is
**"Turn your audience into a business."** Plausible's is **"Easy to use and privacy-friendly
Google Analytics alternative"**. Bitwarden's is **"Credential security for humans, agents, and
machines"**.

Five companies, five sentences a reader actually reads, zero mentions of how the software is
licensed.

### 2. In a selling position, ship the consequence, not the licence

This is the mechanism behind "demote, never delete", and it is the most transferable thing in
the audit. None of the five drop the argument. They restate it as the thing it buys the reader.

- **Ghost** — "independent", "you own your content", "0% transaction fees". Its Substack page
  is titled **"Ghost: The independent Substack alternative with 0% fees"**. Independence is
  what the licence produces; the licence is what produces it.
- **Plausible** — "Your website data is 100% yours and the privacy of your visitors is
  respected." The proof arrives only 70% down the page, and even then it is grammatically
  demoted: "Our code is open source **too**, so you're never locked in." Appended to an
  independence argument, never standing alone.
- **PostHog** — "usage-based", "no unexpected bills".
- **Bitwarden** — "THE MOST TRUSTED PASSWORD MANAGER", and the licence surfaces as **"Trusted
  security — Open source transparency, third party audited, and community-reviewed"**, the
  third of three feature tiles, 30% down.

Our own homepage already does this correctly. The bento card is titled **"Anyone can read the
code"** — the consequence — and the licence sits in the body beneath it. That card is the model
for every other surface we own.

### 3. When the licence does appear in a title, it modifies the job noun

It never stands as the category:

> Bitwarden `/open-source/` — **Open Source Password Manager**
> Plausible `/open-source-website-analytics` — **Open source Google Analytics alternative**
> Ghost homepage — **Ghost: The best open source blog & newsletter platform**

In all three the licence is an adjective and the noun is the job a buyer searches for. Compare
our old homepage `<title>`, **"Open-Source Calendar Syncing for Google, Outlook & iCloud"** —
where "Open-Source Calendar Syncing" was offered as the category itself. The fix is not to
delete the word. It is to make sure a job noun is carrying the sentence.

### 4. The proof has a fixed home, and it is late

Every one of the five puts it in the same three or four places. This is a specification, not a
range:

- **Footer link or badge.** Cal.com's homepage says it once, as anchor text at 89% down:
  `<a href="https://github.com/calcom/cal.com">Self-hosted</a>`, beside a `Docker` link. Ghost
  uses a footer badge, `alt="Open Source"`, linking to its repo alongside "Non-Profit
  Foundation" and "Carbon Neutral".
- **A trust block near the bottom.** Ghost, at 90% down: **"A product you can depend on. Ghost
  is open source, independent, and funded 100% by its users."** Plausible's "P.S." block at 70%.
- **One row in the comparison table.** Plausible's GA4 page: `| Open source | Yes | No |`, the
  **last** row, below cookie consent, personal data, ad blockers, retention and EU hosting.
- **Docs, unhedged.** PostHog's `/docs/self-host`, cal.com's Docker quick-start. Register C
  runs free here and always has.

Our rule says "one position later" and leaves the destination to judgement. The failure mode of
a vague demotion is quiet deletion, which has already been flagged once. Name the home.

### 5. Self-hosting is demoted harder than open source, everywhere

We treat them as one term. The evidence says they are two, and self-hosting sits lower.

- **Plausible** publishes `/self-hosted-web-analytics` and links it **zero times from the
  homepage** — not in nav, not in the footer. It is reachable only from the open-source page
  and the sitemap. The string `AGPL` appears on no nav-linked page at all.
- **Bitwarden** puts self-hosting on `/pricing/` as the **final row of the final table**, at 96%
  down.
- **Ghost** frames it as a cost, on the pricing page: **"When you're under attack or the servers
  catch fire, if you self-host then you're the one who loses sleep. With Ghost(Pro), we lose
  sleep!"** Even its own install doc opens **"The fastest way to get started is to set up a site
  on Ghost(Pro)."**
- **cal.com** gives it one footer link.

Ghost's framing is the same trade `positioning.md` already asks us to make — a server, a domain,
updates, backups, being paged — written as one sentence with a joke in it. Worth copying, on the
page where the reader is choosing a plan.

### 6. The demotion is a dated, deliberate migration in three of the five

Cal.com, PostHog and Ghost all used to lead with the licence and all stopped. The archives have
it precisely.

| | `<title>` then | `<title>` now |
|---|---|---|
| cal.com | Cal.com \| **Open** Scheduling Infrastructure *(2022-04, unchanged through 2024-04)* | Cal.com \| Scheduling Software for Online Bookings |
| PostHog | PostHog - The **open source** Product OS *(2023-06)* | PostHog – We make your product self-driving |
| Ghost | Ghost - The Professional Publishing Platform *(2018-06, meta: "Ghost is an **open source** publishing platform…")* | Ghost: The best open source blog & newsletter platform |

Cal.com's 2022 meta description read **"Open Source Scheduling: Send a link and meet or build an
entire marketplace for humans to connect."** It cleared the meta description first, then the H1,
then the title. PostHog's peaked at **53 on-page mentions** in mid-2023 and reached **zero** by
2026, its H1 moving from "The open source Product OS" to "Shift your product into self-driving
mode". Ghost went the other way in one slot only, moving the licence out of the meta description
and later back into the `<title>`, while its H1 has read "Turn your audience into a business."
since 2022.

Two things fall out of this that no single snapshot shows.

**The H1 was never the licence's home, even at peak.** Cal.com's 2022 H1, with "Open Source
Scheduling" in its meta description, was still "Scheduling infrastructure for absolutely
everyone." The licence lived in the two fields written for a machine and never in the sentence
written for a person.

**Dropping the licence and dropping the abstraction are the same edit.** "Scheduling
infrastructure for absolutely everyone" and "The better way to schedule your meetings" describe
one product. Only the second describes it to someone with a problem. Every company in the table
made both changes at once, because both are the same failure: writing from the builder's side of
the screen. That is rule 1 of this skill, arrived at independently by five companies.

## Placement table

| Surface | Best-in-class put here | Best-in-class do not put here |
|---|---|---|
| `<title>` | The job noun, licence permitted only as its adjective | The licence as the category |
| Meta description | Who it is for and what it does | The licence, unless it is the literal proof of the promise (see Plausible) |
| H1 | The outcome in the reader's words | Anything about how the software is built |
| Hero subhead | Which of their tools it works with | Docker, AGPL, CalDAV, API |
| Above-fold CTA | The product verb — "Get started free" | "View on GitHub", star counts |
| Nav | Product, Pricing, Docs | An "Open Source" or "Self-hosting" top-level item |
| First sentence of a page | The reader's situation | The licence |
| Trust block, ~90% down | "Open source, independent, funded by its users" | — |
| Footer | A repo link or badge, beside Docker | Nothing — this is the guaranteed home |
| Comparison page title | The buyer's question — "Calendly Pricing 2026" | "Open-source alternative to X" |
| Comparison table | One row, late, plainly ticked | — |
| Comparison verdict | Which product suits which reader | "Choose us if you want open source" |
| Structured-data `description` | The job, in one sentence | The licence as the first adjective |
| `llms.txt` opening summary | The job first; licence only as an adjective on the job noun | The licence as a standalone sentence |
| `llms.txt` later sections | A dedicated open-source section, numbered late | — |
| Pricing page | The trade self-hosting asks of the reader | The licence as a plan feature |
| Dedicated open-source page | Everything, unhedged | — |
| Docs and developer surfaces | Everything, unhedged | — |

## Where our current rule is wrong or incomplete

**It is right about every position it names, and right for the right reason.** No comparator
fills the unanimous six. Three of them cleared those slots deliberately, over years, while
growing into the buyer-intent market we are locked out of. The rule needs correcting in four
places, none of which loosen it much.

**1. It is flat where the evidence is graded.** Six positions are unanimous and five are
contested one-for-five. Treating them alike spends reviewer judgement uniformly on things that
need none, and gives no help at all on the ones that do. State the six as absolute and the rest
as arguable with a named condition.

**2. It bans the licence from `llms.txt` outright. Bitwarden disagrees, on purpose.** Its
`llms.txt` opens:

> The most trusted **open source** password manager for passwords, passkeys, and secrets — for
> business, enterprise, and personal use, on any browser or device.

The next line is the HTML meta description, which omits "open source" entirely. Bitwarden is
running two positioning statements — one for humans, one for machines — and its `robots.txt`
opens `.md` and `llms.txt` to ClaudeBot, GPTBot and PerplexityBot while disallowing `.md` for
everyone else. This is current, considered, and from a domain with roughly 536,000 US organic
visits a month.

It matters to us more than to anyone, because the damage we measured was an assistant reading
our page and filing us as self-hoster tooling. Bitwarden's answer is not to strip the licence
from the machine-readable file. It is to keep the licence **an adjective on the job noun** —
"open source password manager" — so no summariser can come away with the licence as the
category. Ours does the opposite. Our `llms.txt` summary ends:

> Keep your personal, work, business and school calendars in sync automatically… **Open source,
> and yours to self-host.**

A standalone sentence, with the job already finished, inviting exactly the summary we got. The
correction is not "remove it". It is "never let it be its own sentence there".

**3. It ranks the structured-data `description` alongside the `<title>`. Ghost shows it is
stricter.** Ghost puts "open source" in its `<title>` and **deliberately omits it from the
JSON-LD `WebSite.description`**, which repeats the meta description instead. The title is a
snippet and ranking target; the JSON-LD description is the sentence a machine quotes when asked
what the product is, with no keyword upside. Ghost spends the licence where it can win traffic
and withholds it where it can only define. Our `softwareApplicationSchema` currently ends
"Open source and self-hostable." — the one slot the most licence-forward comparator refuses to
use.

**4. "Privacy is the promise, open source is the proof" survives, and Plausible is its
warrant.** Plausible is the only comparator with our exact pair, and it spends its single
defining-position allowance on precisely that:

> **Plausible is a lightweight and open-source Google Analytics alternative. Your website data
> is 100% yours and the privacy of your visitors is respected.**

Word five, in the meta description and in the JSON-LD description, on a domain ranking on
roughly 2,000 US keywords. Note the slot it chose: the meta description, not the `<title>`
(**"Plausible Analytics | Simple, privacy-friendly Google Analytics alternative"**), not the H1,
not the hero. If we ever spend one defining position on the licence, that is the one, and the
sentence has to carry the promise in the same breath.

**5. "Demote, never delete" is our value, not the industry's — say so.** Cal.com went closed
source. PostHog's homepage is at zero mentions. Ghost dropped it from the meta description
before restoring it to the title. Three of five deleted at some point. The maintainer's "never
delete" is a house commitment, and it should be written as one rather than presented as what
the best in the category do. What they actually do is keep the proof and move it; what several
of them eventually did is something else.

## The counter-examples

### Bitwarden puts open source first in a comparison verdict

Our rule forbids it. Bitwarden does it, on the page comparing itself to a closed-source rival,
where the closing verdict list runs:

> **1. Open-Source Transparency** — Bitwarden: Fully open-source with community audits and
> contributions.

Ranked first of eight, above cost. It also welds the term into a section header — "Why do users
choose Bitwarden over Keeper as an open source password manager?" — and into the closing CTA.

**Why it works there and not here.** Bitwarden sells to IT and security buyers whose actual
purchase criterion is whether they can audit the thing. For that reader the licence is not
ideology, it is the specification. We sell to a person with two calendars and a scheduling
problem, for whom auditability is not a criterion at all. Note also what Bitwarden still will
not do: the licence stays out of that page's `<title>` and meta description
(**"Bitwarden vs Keeper: Which Password Manager is Better?"**). The SERP-facing snippet sells
the job; the on-page argument sells the licence to a reader who is already comparing.

So the ban holds for us, with its condition now stated: **the licence may lead a verdict when
the reader's purchase criterion is auditability.** Ours is not.

*One caution on this citation.* It is about placement only. That page is a competitor comparison
that happens to share our name collision, and it is not a template for anything we write —
brand-disambiguation copy is ruled out here regardless of who else runs it.

### Ghost keeps open source in its `<title>`

**"Ghost: The best open source blog & newsletter platform"** — the licence in the most defining
slot on the site, for a product sold to writers, not engineers. Ghost is the only comparator
that does this, and it does it while keeping the H1, hero, first paragraph, JSON-LD description
and all three comparison titles clean.

**Why it works for them.** Ghost's biggest competitor, WordPress, is also open source — its own
comparison table row reads `Open source ✅ Yes ✅ Yes`, non-differentiating by its own admission.
The licence therefore cannot be Ghost's argument, and it is not: the argument is independence
and 0% fees. The word survives in the title as a search term, not as a claim. That is the
narrowest possible reading of a title tag, and it is the correct one.

### PostHog was a counter-example until 2023

Worth recording because the expectation was so strong. PostHog held "open source" in its
`<title>`, H1 and meta description for four years, peaking at 53 homepage mentions in mid-2023,
then removed it from every defining position between mid-2023 and mid-2024. Today its homepage
has zero mentions, no JSON-LD, no `/open-source` page (404), and its pricing page frames the
licence as a consolation:

> We have an open source product too. It is MIT licensed if you want to use it in a big
> organization that isn't ready to move to PostHog Web yet.

The company is still loudly open source in culture — public repo, public roadmap, MIT. None of
it is in a defining position on the marketing site. Culture and copy are separable, which is the
whole premise of our rule.

### Cal.com stopped being open source

The finding that outranks the rest, from cal.com's own `llms.txt`:

> **Licensing changed in April 2026.** The commercial edition of Cal.com is now **closed
> source**. The open-source, self-hostable, community edition is a **separate project called
> Cal.diy**, released under the MIT license. Do not describe the main Cal.com product as open
> source.

Our closest comparator demoted the licence out of every defining position and then out of the
product. The trajectory validates the demotion; the destination is not one we are going to, and
"never delete" gets no support from cal.com at all. Read the placement evidence from cal.com and
the durability evidence from Plausible, Bitwarden and Ghost, which all still ship the licence
and still rank.

The usable half: cal.com now runs the licence question as a **separate brand on a separate
domain**, which is what let the commercial site stop hedging. We have a weaker version of the
same tool — `/self-hosting` is already a Register B page — and we under-use it.

### Nobody has a `/compare` hub or an open-source landing page in their main nav

`cal.com/compare`, `cal.com/open-source` and `cal.com/self-hosting` all return 200 and all serve
**somebody's booking page** — a coworking space, a person named Jean. The marketing site never
claimed those slugs. Every cal.com comparison lives in `/blog/` under the buyer's question.
PostHog's `/open-source` is a 404. Ghost has no open-source page beyond `/about/`. Bitwarden's
`/open-source/` and Plausible's `/open-source-website-analytics` exist but sit inside dropdowns —
"Resources" and "Why Plausible" respectively — never at the top level.

Our own `open-source-calendar-sync.mdx` is the right shape: a page that wins the licence query
for the readers who type it, so the licence does not have to leak into the pages that win the
job query.

## What could not be verified

**Semrush returned `403 ERROR 132 :: API UNITS BALANCE IS ZERO` on every keyword-level report**,
for all five domains. The buyer-intent-versus-licence **traffic share is COULD NOT VERIFY** and
must be re-run when units are available. Two `domain_rank` calls landed before the balance
emptied: bitwarden.com at 24,701 US organic keywords and 536,147 monthly organic visits;
plausible.io at 2,046 and 10,495; posthog.com at 8,320 and 33,864.

In its place this file cites **on-page targeting** — what each page's `<title>`, meta
description and slug are written to win. That proves what these companies aim at, not what they
receive, and it is the weaker of the two claims. It is enough for a placement rule, which is
what this file is, and not enough to settle whether any of them still rank on legacy authority
for licence terms they no longer target.
