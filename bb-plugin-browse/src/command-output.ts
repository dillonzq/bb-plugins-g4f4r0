/** Strip irrelevant runtime bookkeeping while keeping failed batch steps reviewable. */
export function commandOutput(raw: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (Array.isArray(parsed)) {
    for (const step of parsed)
      if (step.result?.lifecycle) delete step.result.lifecycle;
  } else {
    if (parsed.data?.lifecycle) delete parsed.data.lifecycle;
    if (parsed.success === false)
      throw new Error(parsed.error || "Browser command failed");
  }
  return JSON.stringify(parsed);
}
export function recoverCommandOutput(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    JSON.parse(raw);
  } catch {
    throw error;
  }
  return commandOutput(raw);
}
