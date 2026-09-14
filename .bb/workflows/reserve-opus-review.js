export const meta = {
  name: "reserve-opus-review",
  description: "Three sequential Opus 5 review-and-fix passes on Reserve",
  phases: [
    { title: "Pass 1", detail: "Find and fix races, bugs, and dead weight" },
    { title: "Pass 2", detail: "Re-review the tree and apply remaining fixes" },
    { title: "Pass 3", detail: "Final leftover pass only" },
  ],
};

const rules = [
  "You are reviewing and tightening the BB plugin Reserve.",
  "Package path: /home/g4f4r0/projects/bb-plugins/bb-plugin-reserve",
  "Plugin id is reserve. Do not change it.",
  "Edit only files under bb-plugin-reserve. Leave every other plugin, Dusk, Sidetree, and git history alone.",
  "Do not commit, tag, push, marketplace-submit, or run git config.",
  "Do not consume a Codex reset credit while verifying.",
  "After source edits: npm test, npm run typecheck, then bb plugin build . && bb plugin reload reserve from bb-plugin-reserve. Fix failures you caused.",
  "Hunt: race conditions, stale snapshots, abort/disposal leaks, polling while hidden, reset-confirm races, concurrent reload/consume, missing validation, dead code, duplication, bugs, accessibility, and data-loss.",
  "Simplify and DRY only when it removes real weight. Do not add abstractions, extra files, packages, or config-for-a-constant.",
  "Go as fast as possible. Prefer the smallest correct diff. Skip speculative rewrites and over-engineering.",
  "Keep shipped UI: login cards with provider glyph/name, email+plan pills, nested windows, host row, footer Updated at + ghost reload, Use reset confirm (Are you sure / Cancel / Confirm; Cancel stays open), tooltip Usage, stacked skeleton with bigger blocks (3 login sections + footer).",
  "Polling runs only while the popover is visible. Unique leftover windows stay unique per providerId + accountEmail.",
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
    "This is pass 1 of 3. Read the live Reserve source, tests, and README.",
    "Fix every real defect you would not ship. Skip speculative rewrites.",
    "Return changed=true if you edited files. Summarize what you fixed. List only remaining real issues.",
  ].join("\n\n"),
  {
    provider: "claude-code",
    model: "claude-opus-5",
    reasoningLevel: "high",
    label: "reserve-review-1",
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
    provider: "claude-code",
    model: "claude-opus-5",
    reasoningLevel: "high",
    label: "reserve-review-2",
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
    provider: "claude-code",
    model: "claude-opus-5",
    reasoningLevel: "high",
    label: "reserve-review-3",
    phase: "Pass 3",
    schema: resultSchema,
  },
);

return { pass1, pass2, pass3 };
