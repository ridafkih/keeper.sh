---
name: sync-engine-overhaul
description: Complete rewrite of the sync engine to fix backpressure, redundant fetches, and locking issues — prompted by real user impact (syncs delayed by hours instead of minutes)
type: project
---

Sync engine overhaul in progress as of 2026-03-15.

**Why:** The current sync engine generates enormous backpressure. Despite promising 30-min (free) / 1-min (pro) sync intervals, syncs frequently take hours. 127 users, 76 accounts, 125 calendars, 21,066 events but only 5,762 with active mappings. Many users only use Keeper for ICS aggregation.

**Key problems to fix:**
1. Redundant iCal fetching (pulled by snapshot job AND push job)
2. Events pushed individually causing backpressure
3. Database tables are messy
4. Locking is not properly implemented

**Design requirements:**
- Jobs must be completely idempotent
- Jobs must be interruptible at any point with no downsides
- Jobs should not write to DB until the very end of their run
- Jobs should be interruptible/cancellable if the same calendar's job is called again
- Must handle thousands of events without pool exhaustion even on small deployments

**How to apply:** All sync-related changes should follow these principles. The sync engine lives in `packages/calendar/` (core, providers, ics) and `services/cron/src/jobs/`.
