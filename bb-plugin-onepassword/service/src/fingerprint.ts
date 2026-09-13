import { readFileSync } from "node:fs";
import { workerConfigSchema, profileDigest } from "./worker.js";
const file = process.argv[2];
if (!file) throw Error("Usage: node dist/fingerprint.js /path/to/worker.json");
const config = workerConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
process.stdout.write(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(config.profiles).map(([id, p]) => [id, profileDigest(p)]),
    ),
    null,
    2,
  ) + "\n",
);
