// Console events and request URLs are untrusted page data. A count limit alone
// still retains gigabytes when a page logs large strings or uses data URLs.
export function boundedDiagnostic(value: unknown, maxCharacters = 16000): unknown {
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= maxCharacters) return value;
  return { truncated: true, preview: json.slice(0, Math.floor((maxCharacters - 128) / 2)) };
}
export function diagnosticUrl(value: string): string {
  return value.length > 8192 ? value.slice(0, 8160) + '… [truncated]' : value;
}
