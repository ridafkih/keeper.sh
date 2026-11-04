import { type } from "arktype";

/* Better Auth compares the issuer to this value, so use a canonical tenant GUID,
   not a domain alias whose tokens name the directory's GUID instead. */
const microsoftTenantIdSchema = type("string | undefined")
  .pipe((value) => value?.trim().toLowerCase() || "common")
  .to(type("'common' | 'organizations' | 'consumers'").or(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ));

export { microsoftTenantIdSchema };
