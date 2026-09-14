export const DISK_CONFLICT =
  "This file changed on disk. Reload, then save again.";

export function fileSyncAction(
  currentSha256: string | null,
  nextSha256: string,
  dirty: boolean,
): "same" | "reload" | "conflict" {
  if (currentSha256 === null || currentSha256 === nextSha256) return "same";
  return dirty ? "conflict" : "reload";
}
