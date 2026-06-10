const MIGRATION_GUIDE_URL = "https://github.com/ridafkih/keeper.sh/issues/140";

const DEPRECATED_ENV_VARS: Record<string, string> = {
  API_URL: "VITE_API_URL",
  NEXT_PUBLIC_COMMERCIAL_MODE: "COMMERCIAL_MODE",
  NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID: "POLAR_PRO_MONTHLY_PRODUCT_ID",
  NEXT_PUBLIC_POLAR_PRO_YEARLY_PRODUCT_ID: "POLAR_PRO_YEARLY_PRODUCT_ID",
  VITE_POLAR_PRO_MONTHLY_PRODUCT_ID: "POLAR_PRO_MONTHLY_PRODUCT_ID",
  VITE_POLAR_PRO_YEARLY_PRODUCT_ID: "POLAR_PRO_YEARLY_PRODUCT_ID",
  NEXT_PUBLIC_VISITORS_NOW_TOKEN: "VITE_VISITORS_NOW_TOKEN",
  NEXT_PUBLIC_GOOGLE_ADS_ID: "VITE_GOOGLE_ADS_ID",
  NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL: "VITE_GOOGLE_ADS_CONVERSION_LABEL",
};

export function checkMigrationStatus(): void {
  const found: string[] = [];

  for (const oldVar of Object.keys(DEPRECATED_ENV_VARS)) {
    if (process.env[oldVar]) {
      found.push(oldVar);
    }
  }

  if (found.length === 0) {
    return;
  }

  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║  KEEPER MIGRATION NOTICE                                   ║",
    "║  Your environment contains variables from the old Next.js  ║",
    "║  setup that are no longer used.                            ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    "  Deprecated variables detected:",
    ...found.map((oldVar) => {
      const replacement = DEPRECATED_ENV_VARS[oldVar]!;
      return `    ${oldVar} → ${replacement}`;
    }),
    "",
    `  Migration guide: ${MIGRATION_GUIDE_URL}`,
    "",
  ];

  console.warn(lines.join("\n"));
}
