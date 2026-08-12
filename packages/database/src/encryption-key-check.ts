const MIGRATION_GUIDE_URL = "https://github.com/ridafkih/keeper.sh#environment-variables";

const checkEncryptionKeyConfigured = (encryptionKey: string | undefined): void => {
  if (encryptionKey) {
    return;
  }

  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║  KEEPER MIGRATION REQUIRED                                   ║",
    "║  ENCRYPTION_KEY is now required. Without it the api, cron    ║",
    "║  and worker services cannot store or read credentials.       ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    "  Starting with this version, OAuth access and refresh tokens",
    "  are encrypted at rest with the same ENCRYPTION_KEY already",
    "  used for CalDAV credentials.",
    "",
    "  To fix this:",
    "",
    "    1. Generate a key with: openssl rand -base64 32",
    "    2. Set ENCRYPTION_KEY to that value in the api, cron and",
    "       worker environments, using the same value for all three",
    "",
    "  Reusing an existing ENCRYPTION_KEY is correct. Changing an",
    "  existing key makes already-encrypted credentials unreadable.",
    "",
    `  Migration guide: ${MIGRATION_GUIDE_URL}`,
    "",
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
};

export { checkEncryptionKeyConfigured };
