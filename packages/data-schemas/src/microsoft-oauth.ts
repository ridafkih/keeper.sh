import { type } from "arktype";

const microsoftDirectoryTenantSchema = type("'common' | 'organizations' | 'consumers'").or(
  type(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).brand("MicrosoftDirectoryId"),
);

type MicrosoftDirectoryTenant = typeof microsoftDirectoryTenantSchema.infer;

interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenant: MicrosoftDirectoryTenant;
}

export { microsoftDirectoryTenantSchema };
export type { MicrosoftDirectoryTenant, MicrosoftOAuthCredentials };
