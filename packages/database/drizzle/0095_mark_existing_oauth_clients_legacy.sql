UPDATE "oauth_application" SET "metadata" = (
  COALESCE(NULLIF("metadata", ''), '{}')::jsonb || '{"keeper_token_version": 1}'::jsonb
)::text;
