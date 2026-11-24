# @repo/e2e

Vespin's end-to-end journeys on Playwright Test (`playwright.config.ts`).

```
pnpm --filter @repo/e2e test:e2e   # every journey, as CI's End-to-end job runs them
```

A failed test is never retried, so a flaky journey fails the gate. A flaky
journey is fixed or deleted.
