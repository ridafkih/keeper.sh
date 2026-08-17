# @keeper.sh/sync-caldav

The CalDAV adapter (RFC 4791) behind `CalendarProvider<"caldav">`. Poll-only: there is no `watch`
method, and that absence is the capability signal.

## tsdav is taken, and extended at exactly four points

`tsdav@^2.1.8` owns the transport, discovery, XML generation and parsing, the REPORT bodies and the
per-response projection. Discovery in particular is entirely tsdav's: `src/calendars/discover.ts` calls
`createAccount` (`.well-known/caldav` → `DAV:current-user-principal` → `CALDAV:calendar-home-set`) and then
`fetchCalendars`, and only filters the result down to collections whose
`supported-calendar-component-set` includes `VEVENT`. It is extended — never replaced — where the contract
needs something its per-response projection cannot express.

1. **Requested-vs-returned verification over `calendarMultiGet`.** tsdav returns whatever the server
   answered with. A capped multiget therefore reads downstream as a shorter object set, and a shorter
   object set reads as deletions. `src/listing/multiget.ts` batches at `caldavLimits.multigetBatchSize`
   and diffs the requested path set against the returned one.
2. **An injected digest-aware fetch under `authMethod: "Custom"` with a no-op `authFunction`.**
   `@keeper.sh/digest-fetch` already solves nonce-keyed sessions and monotonic, zero-padded nonce
   counts. tsdav's own `Digest` support re-derives the challenge per request.
3. **RFC 6578 and RFC 4918 response classification.** tsdav's `syncCollection` returns `DAVResponse[]`,
   which loses the multistatus root: the `DAV:sync-token`, the collection href's `507`
   (`DAV:number-of-matches-within-limits`, RFC 6578 §3.6) and the `DAV:error` precondition
   (`DAV:valid-sync-token`). `src/report/multistatus.ts` reads the document root with `xml-js`;
   `src/report/sync-report.ts` classifies it. The same truncation marker can appear on a Depth-1
   `propfind`, which tsdav also does not model, so `src/listing/enumerate.ts` reads it there too — that is
   what keeps a capped enumeration from reading as a complete membership list on the servers with no
   `sync-collection` at all. `smartCollectionSync` is not used, because it makes the truncation,
   token-rejection and root-token decisions for us and makes all three wrong for us.
4. **href normalisation and the url filter.** Percent-encoding, trailing slashes and absolute versus
   relative hrefs differ per server, so `src/identity/resource-path.ts` is the single normalisation and
   the matching of a response href to a requested one is ours.

Nothing else here re-implements tsdav, and `updateObject`/`deleteObject` are never called with the bare
optional `etag` parameter — an unconditional write is not expressible in this package.
