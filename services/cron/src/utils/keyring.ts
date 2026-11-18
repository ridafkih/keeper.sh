import { createKeyring } from "@keeper.sh/database";
import env from "@/env";

const keyring = createKeyring({
  decryptOnlyKeys: env.ENCRYPTION_KEYS_DECRYPT_ONLY,
  primaryKey: env.ENCRYPTION_KEY,
});

export { keyring };
