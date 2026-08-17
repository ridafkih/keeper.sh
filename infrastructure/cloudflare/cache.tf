locals {
  path_matches   = [for path in var.cacheable_paths : format("http.request.uri.path eq %q", path)]
  prefix_matches = [for prefix in var.cacheable_path_prefixes : format("starts_with(http.request.uri.path, %q)", prefix)]

  marketing_html_expression = format("(%s)", join(" or ", concat(local.path_matches, local.prefix_matches)))
}

resource "cloudflare_ruleset" "cache" {
  zone_id     = var.zone_id
  name        = "Cache settings"
  description = "Cache settings for keeper.sh"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [
    {
      ref         = "cache_marketing_html"
      description = "Cache anonymous marketing HTML at the edge"
      expression  = local.marketing_html_expression
      action      = "set_cache_settings"

      action_parameters = {
        cache = true

        edge_ttl = {
          mode = "bypass_by_default"
        }

        browser_ttl = {
          mode = "respect_origin"
        }

        origin_cache_control = true

        cache_key = {
          cache_deception_armor = true

          custom_key = {
            query_string = {
              exclude = {
                all = true
              }
            }
          }
        }
      }
    }
  ]
}
