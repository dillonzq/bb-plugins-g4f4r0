import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(import.meta.url));
(globalThis as { require?: NodeRequire }).require = require;
