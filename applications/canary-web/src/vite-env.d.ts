/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_COMMERCIAL_MODE?: string;
  readonly VITE_POLAR_PRO_MONTHLY_PRODUCT_ID?: string;
  readonly VITE_POLAR_PRO_YEARLY_PRODUCT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
