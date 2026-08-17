# Cloudflare configuration

Configuration for the Cloudflare zone in front of the hosted keeper.sh.

**This is hosted-only.** Self-hosted instances do not need it. `deploy/compose.yaml`
puts Caddy in front of the stack and terminates TLS itself; nothing here is
required to run keeper.sh on your own infrastructure.

Written for [OpenTofu](https://opentofu.org), which is a drop-in for Terraform.
`terraform` works too if you prefer it.

## What it manages

One cache rule. Cloudflare does not cache `text/html` by default, so without it
the marketing pages are re-rendered on every request no matter what the origin
sends.

The origin already does the work: anonymous marketing HTML is byte-identical for
every visitor and carries `public, max-age=0, s-maxage=600,
stale-while-revalidate=86400` with `vary: accept-encoding`. Requests carrying a
session cookie, and every path under `/dashboard`, `/login`, `/register`, `/api`
and `/internal`, get `private, no-store` and are never publicly labelled.

Signed-in visitors are served the same cached anonymous HTML. `SessionSlot`
renders both nav branches and an inline `<head>` script stamps `data-session` on
`<html>` from the session cookie, so CSS picks the right branch before first
paint.

## Keeping it in sync with the app

`cacheable_paths` and `cacheable_path_prefixes` must match `cacheableHtmlPaths`
in `applications/web/src/server/http-handler.ts`. A path listed here but not
there gets cached at the edge while the origin sends `private, no-store`, and the
rule silently does nothing. Blog post paths come from the MDX files, so a new
post is covered by the `/blog/` prefix without a change here.

## Running it

Requires an API token with the permissions Cloudflare documents for managing
cache rules — **Zone > Cache Rules > Edit**, **Account Rulesets > Edit** and
**Account Filter Lists > Edit** — plus **Zone > Zone > Read** so the provider can
resolve the zone. R2 credentials are needed separately for the state backend.

```sh
cp terraform.tfvars.example terraform.tfvars   # then fill in zone_id
export TF_VAR_cloudflare_api_token=...
export AWS_ACCESS_KEY_ID=...                   # R2 access key
export AWS_SECRET_ACCESS_KEY=...               # R2 secret key

tofu init
tofu plan
tofu apply
```

Set the R2 account ID in the `endpoints` block in `versions.tf` before the first
`init`; backend config cannot use variables.

## Adopting the rule that already exists

The cache rule was created by hand in the dashboard before this config existed,
so the zone already has an `http_request_cache_settings` entry point ruleset.
Import it before the first apply — applying against empty state will try to
create a second one.

Find the ruleset ID:

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r .result.id
```

Then import it and confirm the plan is empty, which is what proves this config
matches what is live:

```sh
tofu import cloudflare_ruleset.cache "$ZONE_ID/$RULESET_ID"
tofu plan
```

A non-empty plan means the two have drifted. Read the diff before applying —
the dashboard rule is the one currently serving traffic.

## State

State lives in an R2 bucket, not in the repo. `.gitignore` covers `*.tfstate*`
and `*.tfvars`, and it should stay that way — OpenTofu writes resource
attributes to state in plaintext, including anything marked sensitive.

Commit `.terraform.lock.hcl` when it appears. It is provider hashes, not secrets,
and pinning them is the point.

## Verifying

```sh
curl -sI https://www.keeper.sh/blog | grep -i cf-cache-status
```

`DYNAMIC` means the rule is not in effect. A `HIT` or `MISS` means it is. Expect
`MISS` on the first request to a given path in a given colo, then `HIT`.
