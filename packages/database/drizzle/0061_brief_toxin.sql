CREATE INDEX "calendar_accounts_needs_reauth_idx" ON "calendar_accounts" USING btree ("needsReauthentication");--> statement-breakpoint
CREATE INDEX "event_mappings_sync_hash_idx" ON "event_mappings" USING btree ("syncEventHash");--> statement-breakpoint
CREATE INDEX "event_states_end_time_idx" ON "event_states" USING btree ("endTime");--> statement-breakpoint
CREATE INDEX "oauth_credentials_expires_at_idx" ON "oauth_credentials" USING btree ("expiresAt");