import type { Catalog } from "./catalog/catalog";
import { catalogTranslation } from "./catalog/catalog";
import type { DestinationSyncInput } from "./input/destination-sync-input";
import type { ShadowOptions } from "./options";
import { translateDestinationSync } from "./translate/translate";

const catalogShadowRun = (input: DestinationSyncInput, options: ShadowOptions): Catalog =>
  catalogTranslation(translateDestinationSync(input, options), options);

export { catalogShadowRun };
