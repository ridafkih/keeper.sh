# Security Policy

## Reporting a vulnerability

Report vulnerabilities through GitHub's private reporting form:

**https://github.com/ridafkih/keeper.sh/security/advisories/new**

That opens a private advisory visible only to you and the maintainers. Please use it rather than a public issue, a pull request, or a discussion — a public report puts every self-hosted installation at risk before a fix exists.

You will get an acknowledgement within 5 working days, and an assessment of whether the report is accepted, along with a target fix date, within 10 working days.

## What to include

A report is easiest to act on when it contains:

- the affected component, and a commit or release you tested against
- the configuration it requires, since several behaviours depend on environment variables such as `BLOCK_PRIVATE_RESOLUTION`
- what an attacker controls, and what they gain
- the steps to reproduce it, and a proof of concept if you have one

## Disclosure

Fixes are developed in a private advisory and released before details are published. Once a fix is available, the advisory is published with credit to the reporter unless you ask to stay anonymous, and a CVE is requested where one applies.

We ask for 90 days from acknowledgement before public disclosure, and will usually be much faster. If you have a deadline that conflicts with that, say so in the report and we will agree a date rather than discover the disagreement later.

## Scope

In scope: this repository, the published container images, and the hosted service.

Out of scope: findings that require access to the operator's own host or network, denial of service through ordinary rate limits, missing hardening headers with no demonstrated impact, and reports produced by a scanner without a working reproduction.

Self-hosted installations vary in configuration. Please say which settings your report assumes, as some protections are opt-in and documented as such in the README.
