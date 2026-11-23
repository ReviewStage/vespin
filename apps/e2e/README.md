# @repo/e2e

Vespin's end-to-end journeys on Playwright Test (`playwright.config.ts`).

```
pnpm --filter @repo/e2e test:e2e              # every journey but the quarantined, as CI's End-to-end job runs them
pnpm --filter @repo/e2e test:e2e:quarantine   # only the quarantined
```

## Quarantine

A failed test is never retried, so a flaky journey fails the gate. The one way
out is to quarantine it: tag it `@quarantine` with Playwright's own tags.

```ts
test("answers an ask", { tag: "@quarantine" }, async ({ page }) => {
```

`test:e2e` runs with `--grep-invert @quarantine`, so the PR gate leaves it out.
The nightly `E2E quarantine` workflow (`.github/workflows/e2e-quarantine.yml`)
runs the quarantined journeys alone, uploads their report, and opens an issue
when one fails, or adds to the one already open. With none quarantined it
passes (`--pass-with-no-tests`).

The rule:

- A quarantine opens a task, named for the journey, in the same PR that tags
  it. The PR links the task and the flaky runs.
- A journey still quarantined two weeks after it was tagged is fixed, and its
  tag removed, or deleted. Quarantine is never where a journey lives.

The quarantine nightly runs on Linux, so it runs only the `chromium` project's
journeys. A desktop journey (`specs/desktop/`) is never quarantined: its own
nightly (`e2e-desktop.yml`) is no gate to escape.
