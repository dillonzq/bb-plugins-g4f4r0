import assert from "node:assert/strict";
import test from "node:test";
import {
  emailFromAccountRead,
  normalizeCodexAccountLimits,
  normalizeCodexResetCreditsResponse,
} from "../lib/codex-reset-credits.ts";
import { formatResetCredits } from "../lib/usage.ts";

test("reads the authoritative Codex reset count", () => {
  assert.equal(
    normalizeCodexResetCreditsResponse({
      rateLimitResetCredits: { availableCount: 3, credits: null },
    }),
    3,
  );
  assert.equal(
    normalizeCodexResetCreditsResponse({
      rateLimitResetCredits: { availableCount: "4", credits: [] },
    }),
    4,
  );
  assert.equal(
    normalizeCodexResetCreditsResponse({ rateLimitResetCredits: null }),
    null,
  );
  assert.equal(normalizeCodexResetCreditsResponse({}), null);
  assert.equal(
    normalizeCodexResetCreditsResponse({
      rateLimitResetCredits: { availableCount: -1 },
    }),
    null,
  );
});

test("formats reset availability", () => {
  assert.equal(formatResetCredits(1), "1 reset available");
  assert.equal(formatResetCredits(2), "2 resets available");
});

test("reads ChatGPT email from account/read", () => {
  assert.equal(
    emailFromAccountRead({ account: { type: "chatgpt", email: "a@x" } }),
    "a@x",
  );
  assert.equal(emailFromAccountRead({ account: { type: "apiKey" } }), null);
  assert.equal(emailFromAccountRead({ account: null }), null);
});

test("maps every Codex pool the CLI reports", () => {
  const limits = normalizeCodexAccountLimits({
    rateLimitResetCredits: { availableCount: 1 },
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1_800_500_000 },
      },
      "gpt-5.3-codex-spark": {
        limitId: "gpt-5.3-codex-spark",
        primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1_800_500_000 },
      },
      "gpt-reserve": {
        limitId: "gpt-reserve",
        limitName: "gpt-reserve",
        secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1_800_500_000 },
      },
    },
  });
  assert.equal(limits.availableCount, 1);
  assert.deepEqual(
    limits.coreWindows.map((window) => window.label),
    ["5-hour", "Weekly"],
  );
  assert.deepEqual(
    limits.extraWindows.map((window) => window.label),
    ["Spark · 5-hour", "Spark · Weekly", "Luna Reserve · Weekly"],
  );
  assert.equal(limits.extraWindows[2]?.usedPercent, 5);
});
