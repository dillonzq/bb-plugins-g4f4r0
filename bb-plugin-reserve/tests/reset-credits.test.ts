import assert from "node:assert/strict";
import test from "node:test";
import {
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
