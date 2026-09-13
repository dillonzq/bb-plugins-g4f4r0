import { createClient } from "@1password/sdk";
import type { Mapping } from "./schema.js";
export type ResolveSecrets = (
  mapping: Mapping,
  token: string,
) => Promise<Record<string, string>>;
export const resolveSecrets: ResolveSecrets = async (mapping, token) => {
  const client = await createClient({
    auth: token,
    integrationName: "BB community 1Password plugin",
    integrationVersion: "0.1.0-alpha.1",
  });
  const values: Record<string, string> = {};
  if (mapping.environmentId) {
    const data = await client.environments.getVariables(mapping.environmentId);
    for (const name of mapping.variables) {
      const found = data.variables.find((v) => v.name === name);
      if (!found) throw Error("Variable unavailable.");
      values[name] = found.value;
    }
  }
  for (const [name, ref] of Object.entries(mapping.fields))
    values[name] = await client.secrets.resolve(ref);
  return values;
};
