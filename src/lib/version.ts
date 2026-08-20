import packageJson from "../../package.json";

/**
 * Safe application release identifier for API responses and diagnostics.
 * Never derive this from environment secrets or infrastructure details.
 */
export const APP_VERSION: string = packageJson.version;
