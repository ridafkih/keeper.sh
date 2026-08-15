---
name: marketing-voice
description: Keeper.sh house writing voice for anything a customer reads — the marketing site, pricing and feature sections, comparison pages, blog posts, how-to guides, changelog entries, and app copy. Use when asked to "write the landing page", "draft a blog post", "write a how-to guide", "write the pricing copy", or to review a pull request that changes any of it. Use it just as much for the complaint: "this reads too technical", "this is too jargon-heavy", "make this sound like us", "a normal person wouldn't understand this", "why does our copy sound like documentation". Not for code identifiers, commit messages, PR descriptions, test names, log lines, or the README's architecture notes.
---

# Keeper.sh marketing voice

Our copy reads as though written for someone who has read our source. It is not. Open it up; do not dumb it down — every fact survives, only the difficulty goes.

## Who is reading

A person with two calendars and a scheduling problem. They use Google Calendar or Outlook daily and have never heard the words ICS, iCalendar, CalDAV, OAuth, webhook or sync token. They do not know that "subscribe to a calendar" and "sync a calendar" differ — that confusion is usually why they are reading.

## Pick a register before the first sentence

| Register | Content | Vocabulary |
|---|---|---|
| **A — marketing and how-to** *(default)* | Homepage, `/features`, `/pricing`, `/compare`, guides, app copy | Tier 1 banned, Tier 2 glossed once per page |
| **B — self-hosting and operator** | Docker, env vars, reverse proxies, Radicale, Nextcloud | `BLOCK_PRIVATE_RESOLUTION`, htpasswd — unglossed |
| **C — engineering explainer** | `how-calendar-sync-actually-works.mdx` and its like | `410 GONE`, `RECURRENCE-ID`, `VTIMEZONE`, DST — real names |

**Default to Register A**; pick B or C only for a file named above. A and B hold sentence discipline, C does not. A explains what happens, C why it was hard — C may assume the reader has built something, never that they have read our source. Symptom-first failure modes and question-shaped headings apply in all three.

Read `glossary.md` (tiered terms, with why each fails so you can rule on ones it omits) and `examples.md` (eleven before/after pairs from shipped copy, every edit enumerated) before any substantial rewrite. Also `formatting.md`, `positioning.md` and `length.md`.

## Rules

1. **First sentence names the reader's situation or answers the title's question.** Not what Keeper.sh is.
2. **What the reader sees, then the mechanism.** Never the reverse.
3. **No interval, limit or number without what it costs the reader.**
4. **Rename internal concepts after what the user does with them.** A mapping is a **connection**.
5. **Cut the architecture name, keep the promise it makes.** Redis is our problem.
6. **Explain a credential by what it protects, not what it is.**
7. **Failure modes lead with the symptom the reader would observe.**
8. **Under 25 words in A and B, median 12–15. Paragraphs of three sentences or fewer.**
9. **Attach a person to every capability** — a freelancer with three client calendars, a parent with a school timetable.
10. **Always "Keeper.sh", never bare "Keeper".** A password manager owns that word — AlternativeTo already files us under `keeper-1` because of it — so dropping the `.sh` blurs us in the exact copy meant to tell us apart. Code identifiers, literal strings and other people's words are exempt; the list is at the end of `glossary.md`. Second person; "I" only in signed founder posts.
11. **Length is a section problem, not a sentence problem.** Rule 8 has passed on every article that still shipped far too long. Ceilings by content type, the four redundancy patterns and the deletion test are in `length.md`.
12. **A defining position says what the product does for the reader, never what it is built out of.** Frontmatter, `<title>`, the H1, the hero subhead, a page's or section's first sentence, a comparison's verdict, the opening of `llms.txt` — these are where a reader and an answer engine decide who we are for, and open source, self-hosting, Docker, the API and the licence all read there as "for technical people". Demote, never delete: privacy is the promise, open source is the proof, and the proof keeps its place later in the same surface. Positions, exemptions and the measured cost are in `positioning.md`.

## Hosted first, self-hosting as the alternative

Guides and blog posts are marketing material, not neutral documentation. The happy path is hosted Keeper.sh. Self-hosting gets its own signposted section, never interleaved step by step, described honestly: a server, a domain, updates, backups, being paged when it stops. Never inferior — every Pro feature included when self-hosted is a differentiator competitors concede in writing. Full section in `positioning.md`.

## Accuracy is part of voice: the `[FACT]` protocol

Rewriting is when a wrong claim gets restated more confidently. It has shipped twice, so the check is mechanical rather than a matter of care.

**Before rewriting**, reproduce the copy with every claim tagged — numbers, limits, prices, product and provider names, licences, URLs, capability claims, quotes, dates:

> Free covers [FACT: 2] calendar accounts and [FACT: 3] connections, updating [FACT: every 30 minutes].

**After rewriting**, diff against that list and put every tag in exactly one bucket — **preserved**, **relocated** or **dropped** — defined with worked examples at the end of `examples.md`. A tag you cannot place is a defect, and so is a claim stronger than it went in, however defensible it sounds. If you cannot verify it from the code, leave it out. Two that shipped wrong: we do not do two-way sync (mappings are strictly one-directional), and there is no per-account calendar limit.

## Before publishing

Run the checker; do not estimate what it measures.

```
bun .claude/skills/marketing-voice/scripts/readability.ts [--register=a|b|c] <file...>
```

It reports body words and section count, median sentence length, sentences over 30 words, the longest and where, paragraphs over three sentences, every Tier 1 term with its line, and every audience trigger predicated of Keeper.sh in a defining position, exiting non-zero when Register A breaks. Word count is reported and never gated, because the ceiling depends on content type — read it against the table in `length.md`. Then answer what it cannot:

1. Does the first sentence describe the reader's situation or answer the title's question?
2. Any unglossed Tier 1 or Tier 2 term in the first 40 words?
3. Does every number sit next to what it means for the reader?
4. Is every heading a question or a plain outcome?
5. Does one named, specific scenario appear?
6. Do limitations lead with the symptom?
7. Any sentence only someone who has read our source could parse?
8. Did every `[FACT]` tag land in one bucket?
9. Is the piece inside its ceiling, and would deleting any section leave the reader unable to act?
10. Is every mention of the product "Keeper.sh", and is every bare "Keeper" left standing one of the exemptions in `glossary.md`? The checker does not test this and cannot: bare "Keeper" is correct inside a quotation and inside an identifier, and no pattern separates those from a slip.
11. Do the defining positions the checker cannot reach — a feature card title, a nav label, a product-defining FAQ answer, a hero written in `.tsx`, and any mention of CalDAV, the API or developers — say what the reader gets rather than what we are built out of? The list is in `positioning.md`.
