# Hosted first, self-hosting as the alternative

Blog posts and guides are marketing material, not neutral documentation. The happy path in a guide is hosted Keeper.sh — that is the default the reader should fall into without thinking about it.

Self-hosting still gets presented properly, as a real alternative for readers who are technically inclined or interested. Give it its own signposted section rather than interleaving both paths step by step, so a non-technical reader never has to work out which half of a numbered list applies to them. Describe it honestly, including what it costs: a server, a domain, updates, backups, and being the person who gets paged when it stops.

Do not frame self-hosting as inferior or as a downgrade. Being genuinely open-source with every Pro feature included when self-hosted is a real differentiator that competitors concede in writing, and grudging it would cost us credibility with exactly the audience that amplifies the project.

Register B content — Docker, environment variables, operator guides — is written for self-hosters by nature and needs no hosted nudge.

## What this looks like in a guide

A `sync-X-with-Y` guide has one numbered path, and it is the hosted one. The self-hosting alternative lives under its own heading after that path finishes, not as a parenthetical inside step 4. A reader who wants it will find the heading; a reader who does not will never have to decide whether a step applies to them.

The same rule holds in a founder post. "I built this and you can run it yourself" is the correct order. "Here is how to deploy it, and there is also a hosted version" buries the thing most readers want and makes the hosted service look like an afterthought we are slightly embarrassed by.

## What not to do

- Presenting both paths as equal-weight columns, which makes the reader do the comparison work before they have any reason to care
- Apologising for the hosted service being paid, anywhere
- Describing self-hosting as "free" without the sentence about servers, updates, backups and being paged
- Sending a non-technical reader to a GitHub repository as the answer to a pricing question

# Defining positions

Keeper.sh is a calendar sync product that happens to be open source. Our copy keeps coding it as a tool for technical people, and that miscoding has a price we can read off the numbers: every keyword we rank for is an open-source term, and we appear in no buyer-intent query at all.

The mechanism is worth picturing, because it is not a human skimming. Someone asks an assistant for "the best way to keep my work and personal calendars in sync". The assistant reads one of our pages, takes the sentence that says what we are, classifies us as self-hoster tooling, and recommends a hosted competitor to a person who was never going to run a server. The sentence it took is almost always one of the ones below.

## Where it is a violation

A defining position is a slot that tells a reader — or a model quoting us verbatim — what the product is and who it is for:

- Frontmatter `title`, `description` and `blurb`
- The page `<title>`, the meta description, the H1 and the hero subhead
- The first sentence of a page, and the first sentence of a major section
- A comparison's summary line, its verdict, and its "pick X for…" closer
- `description` fields in structured data
- The opening lines of `llms.txt` and `llms-full.txt`
- Feature card titles, nav labels, and any FAQ answer that defines the product rather than answering a detail

The vocabulary that trips it: open source, AGPL-3.0, licence talk, self-hosting, "your own hardware", "runs on your own server", Docker, images, CalDAV, API, MCP, "developers", CLI, Postgres, Redis.

## Where it is not

Over-triggering is its own failure, and stripping the proof has already been flagged on this project. None of these is a violation:

- Open source, self-hosting or AGPL-3.0 in body copy, once the job is established
- The `/self-hosting` page leading with self-hosting. It is the designated home
- `/pricing` discussing the licence, where the reader is weighing lock-in
- A trust section — "why you can believe this" — that *follows* the product explanation
- Developer-facing docs under `/docs/mcp`, and the repository README
- CalDAV or Fastmail named as supported providers. That is a compatibility fact a buyer wants, not signalling

## The fix

Lead with the job and the outcome for someone non-technical, and keep the proof later in the same surface. Privacy is the promise; open source is the proof of it.

**Demote, never delete.** The replacement has to be at least as specific as what it replaced — swapping "runs on your own hardware" for "built with you in mind" trades a miscoded fact for no fact at all, which is worse. Take the claim the page already proves at length and put that in the slot instead. The worked example is number 11 in `examples.md`.

## What the checker covers

`scripts/readability.ts` flags an audience trigger in frontmatter `title`, `description` or `blurb`, or in the lede — the prose before the first section heading, two paragraphs at most — and only when the sentence predicates the trigger of Keeper.sh itself. "Keeper.sh runs on your own hardware" fails; "Radicale keeps your calendar on your own hardware" does not, because that is a fact about somebody else's software. The trigger list is the "Audience triggers" bullets in `glossary.md`, which is a placement list and not a fourth tier.

Four things it deliberately does not do, because every one of them would fire on copy that is right:

- It skips `.tsx`, so heroes, feature cards and nav labels are yours to read
- It skips the README, `/pricing` and any path naming self-hosting
- It ignores section openers below the lede, where the self-hosting and trust sections legitimately live
- It ignores CalDAV, Fastmail, "developers" and "API", which are usually compatibility answers or somebody else's product

Those are question 11 in the publishing checklist.
