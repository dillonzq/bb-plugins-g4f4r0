# Browser agent capability benchmark

This suite uses a pinned copy of [MiniWoB++](https://github.com/Farama-Foundation/miniwob-plusplus) for fast, deterministic browser-agent trials. MiniWoB++ is MIT licensed and contains more than 100 synthetic web interaction environments. The selected twelve tasks cover clicking, text entry, forms, selects, checkboxes, autocomplete, tabs, scrolling, dragging, multi-step workflows, stateful interfaces, and reading structured content.

## Start the site

From `bb-plugin-browse`:

```sh
npx tsx scripts/miniwob-site.mts
```

The first run clones the exact revision in `tasks.json` into the ignored `.benchmarks` directory. The server binds only to `127.0.0.1:39115`. Use `--port=PORT` to change the port or `--install-only` to populate the cache without starting the server. Start it in the same host network namespace as Browse; an isolated coding sandbox's `127.0.0.1` is not the BB host's loopback address.

## Trial protocol

For every task and trial:

1. Open `/miniwob/TASK.html` in a fresh Browse session.
2. Before the agent sees the page, evaluate `Math.seedrandom(SEED); core.EPISODE_MAX_TIME=60000; core.startEpisodeReal()` to create the task deterministically, set the one-minute budget, and dismiss MiniWoB's synchronization cover.
3. Give the agent only the visible task instruction and its normal Browse tools. Do not expose page globals, source files, expected actions, or the scorer.
4. Stop after the task's `maxActions`, 60 seconds, or an ended episode.
5. In the controller, evaluate `({done:WOB_DONE_GLOBAL,reward:WOB_RAW_REWARD_GLOBAL,reason:WOB_REWARD_REASON,episode:WOB_EPISODE_ID})`.
6. Count success only when `done === true && reward > 0`.

Use the same model, prompt, seeds, viewport, task order, action budget, and trial count for every automation engine. Record success rate, median completion time, p95 completion time, actions, input/output tokens, retries, and browser/tool errors. Run trials sequentially on an otherwise idle host for latency comparisons; use a separate concurrency run for throughput and memory.

This suite measures interaction primitives and short planning. It does not replace realistic long-horizon evaluation. The next tier should use self-hosted WebArena through BrowserGym or AgentLab once a container runtime is available.

## Validated smoke trial

The harness was validated through a managed Fortress session with the `login-user` task and seed `smoke-login-1`. Session startup took 4.418 seconds (browser 506 ms, control 1.051 seconds, navigation and first capture 2.856 seconds). The three browser actions completed in 447 ms and MiniWoB returned `done: true` with reward `1`. These numbers are one local smoke run, not benchmark aggregates.

## Browser primitive regression

Run `BROWSE_TEST_ROOT=/path/to/browse/host-data npm run benchmark:capabilities`. The opt-in live test executes five seeded trials each for `use-autocomplete`, `click-tab-2`, and `book-flight`, the widget patterns that failed the first model trial. It checks direct MiniWoB rewards through the real Fortress runtime and removes its disposable profile. This is a browser/control regression with no model calls; do not compare its completion times with agent planning times.
