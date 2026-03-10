import { getPublicRuntimeConfig } from "../lib/runtime-config";

export const getCommercialMode = () => getPublicRuntimeConfig().commercialMode;
