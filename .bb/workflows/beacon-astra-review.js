export const meta = {
  name: "beacon-astra-review",
  description: "Three sequential GPT-6 Astra reviews of Beacon, each applying remaining fixes",
  phases: [
    { title: "Pass 1", detail: "Find and fix bugs, races, and dead weight" },
    { title: "Pass 2", detail: "Re-review the tree and apply remaining fixes" },
    { title: "Pass 3", detail: "Final pass for leftover issues only" },
  ],
};

const rules = [
  "You are reviewing and tightening the BB plugin Beacon before a 0.1.0 public release.",
  "Package path: /home/g4f4r0/projects/bb-plugins/bb-plugin-beacon",
  "Plugin id is beacon. Do not change it.",
  "Edit only files under bb-plugin-beacon. Leave bb-plugin-sidetree and every other plugin alone.",
  "Do not commit, tag, push, marketplace-submit, or run git config.",
  "Do not install plugins from a thread workspace, /tmp, or a worktree.",
  "After source edits: npm test, npm run typecheck, then bb plugin build bb-plugin-beacon from the repo root. Fix failures you caused.",
  "Look for: correctness bugs, races, stale snapshots, abort/disposal leaks, SQLite/log races, alert cursor bugs, missing validation, security, data-loss, accessibility, and dead code.",
  "Simplify when it removes real weight. Do not add abstractions, extra files, or packages.",
  "Keep the Server footer icon tint: Hugeicons ServerIcon, strokeWidth 2, opacity 0.8. That matches host footer [&>svg]:opacity-80 because custom icons sit in a span.",
  "Keep background monitoring off by default. Keep network rates Linux-only.",
  "Your final answer is the structured workflow result, not a user-facing chat message.",
].join("\n");

const resultSchema = {
  type: "object",
  required: ["changed", "summary", "remaining"],
  additionalProperties: false,
  properties: {
    changed: { type: "boolean" },
    summary: { type: "string" },
    remaining: { type: "array", items: { type: "string" } },
  },
};

phase("Pass 1");
const pass1 = await agent(
  [
    rules,
    "This is pass 1 of 3. Read the live Beacon source, tests, README, PLUGIN_OVERVIEW.md, and skill.",
    "Fix every real defect you would not ship. Skip speculative rewrites.",
    "Return changed=true if you edited files. Summarize what you fixed. List only remaining real issues.",
  ].join("\n\n"),
  {
    provider: "codex",
    model: "gpt-6-astra",
    reasoningLevel: "high",
    label: "beacon-review-1",
    phase: "Pass 1",
    schema: resultSchema,
  },
);

phase("Pass 2");
const pass2 = await agent(
  [
    rules,
    "This is pass 2 of 3. Re-read the tree after pass 1. Do not assume pass 1 is complete.",
    "Pass 1 summary:\n" + JSON.stringify(pass1),
    "Fix remaining real issues. Re-run tests and typecheck after edits.",
    "Return changed, a short summary, and leftover issues. Empty remaining if the plugin is shippable.",
  ].join("\n\n"),
  {
    provider: "codex",
    model: "gpt-6-astra",
    reasoningLevel: "high",
    label: "beacon-review-2",
    phase: "Pass 2",
    schema: resultSchema,
  },
);

phase("Pass 3");
const pass3 = await agent(
  [
    rules,
    "This is pass 3 of 3, the last pass. Hunt leftovers only. Prefer deletion over addition.",
    "Pass 1:\n" + JSON.stringify(pass1),
    "Pass 2:\n" + JSON.stringify(pass2),
    "If nothing real remains, change nothing and set remaining to an empty array.",
    "Re-run tests if you edited.",
  ].join("\n\n"),
  {
    provider: "codex",
    model: "gpt-6-astra",
    reasoningLevel: "high",
    label: "beacon-review-3",
    phase: "Pass 3",
    schema: resultSchema,
  },
);

return { pass1, pass2, pass3 };
