import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hash, secret, Store } from "./store.js";
import { configSchema, mappingSchema } from "./schema.js";
const [directory, origin, projectId] = process.argv.slice(2);
if (!directory || !origin || !projectId)
  throw Error(
    "Usage: node dist/init.js /private/data https://approve.example.com project-id",
  );
const dir = resolve(directory);
if (existsSync(dir))
  throw Error(
    "Choose a new data directory; initialization never overwrites existing credentials.",
  );
const bootstrap = secret(),
  clientToken = secret(),
  workerToken = secret(),
  key = randomBytes(32);
const config = configSchema.parse({
  origin,
  port: 43810,
  listen: "127.0.0.1",
  dataDir: dir,
  keyFile: join(dir, "master.key"),
  bootstrapHash: hash(bootstrap),
  clients: [
    {
      id: "bb",
      label: "BB",
      tokenHash: hash(clientToken),
      projectIds: [projectId],
    },
  ],
  workers: [
    { id: "worker", label: "Protected worker", tokenHash: hash(workerToken) },
  ],
});
mkdirSync(dir, { mode: 0o700, recursive: true });
for (const [name, value] of [
  ["master.key", key],
  ["bootstrap.txt", bootstrap],
  ["client-token.txt", clientToken],
  ["worker-token.txt", workerToken],
  ["config.json", JSON.stringify(config, null, 2)],
] as [string, string | Buffer][])
  writeFileSync(join(dir, name), value, { mode: 0o600, flag: "wx" });
const store = new Store(dir, key);
store.saveMapping(
  mappingSchema.parse({
    id: "verify-approval",
    label: "Try passkey approval",
    projectIds: [projectId],
    workerId: "worker",
    kind: "demo",
    profile: "demo",
  }),
);
store.close();
process.stdout.write(
  "Service initialized. Private configuration and enrollment files are in " +
    dir +
    ". Read bootstrap.txt on the trusted service host to enroll your passkey; copy only client-token.txt into BB settings.\n",
);
