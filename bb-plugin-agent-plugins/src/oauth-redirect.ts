/**
 * Pick the OAuth callback origin a browser can actually reach.
 * Remote BB clients never hit loopback on the server.
 */
export function oauthRedirectBase(options: {
  setting?: string | null;
  appUrl?: string | null;
  loopbackBaseUrl: string;
}): string {
  const setting = trimBase(options.setting);
  if (setting) return setting;
  const appUrl = trimBase(options.appUrl);
  if (appUrl) return appUrl;
  return options.loopbackBaseUrl;
}

/** Read BB_APP_URL when this SDK version exposes it. */
export function serverAppUrl(server: object): string | null {
  if (!("experimental_appUrl" in server)) return null;
  const value = (server as { experimental_appUrl?: unknown }).experimental_appUrl;
  return typeof value === "string" ? value : null;
}

function trimBase(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}
