# Review Guidelines

Report real defects only. `main` merges only once every review thread is
resolved, so each finding holds the pull request for a push, a CI run, and
another review round. When the pull request is sound, say so in one line.

## Report

- Bugs: wrong behavior, crashes, and broken error handling.
- Data loss or corruption.
- Races and ordering bugs.
- Security, including auth, sessions, and token or credential handling.

## Always check

These rules are easy to miss, and nothing in CI holds them:

- Tenancy: a query or procedure over account rows never reads or changes
  another user's own rows or those of a workspace the caller is not in.
- Secrets: a credential never reaches a Gateway answer or event, a counted
  event, a trace, or a fixture (`AGENTS.md`, "Never").
- Released clients: the service deploys on merge, but the desktop, host, CLI,
  and iOS builds stay installed for weeks. A change to what the service sends
  or accepts that they cannot read must follow `AGENTS.md`, "Breaking the
  hosted wire".
- Migrations: they run in the build, before the new deployment serves, so the
  live deployment meets the new schema. Dropping or renaming what it still
  reads breaks production: drop it in a later pull request, once no deployed
  code reads it. They also run in one transaction
  (`packages/database/README.md`), so never suggest `CONCURRENTLY`.
- Session replay: a person's words (a member's, Manager's, or device's name, a
  message) never stand under `ReplayUnmask` without a nearer `ReplayMask`
  (`AGENTS.md`, "Never").
- Experiments: a feature behind a workspace experiment stays hidden
  everywhere it shows (lists, Recent, counts, links) while the experiment is
  off.

## Severity

- P0: breaks production, loses or leaks data, or opens a security hole.
- P1: a real bug on a path users reach, or a broken rule under Always check.
- P2: a real defect unlikely to bite. Report one only when there is no P0 or
  P1.

Post at most five findings, the most severe first.

## Do not report

- Style, naming, comment wording, or formatting.
- Test style: call-count assertions, test structure, or a missing test.
- The conventions in `AGENTS.md` and `docs/STYLE.md`, such as `as const`,
  design tokens, file order, and comment length. Lint and CI hold what they
  can, and the rest isn't worth a review round. The rules under Always check
  are not conventions.
- A missing edge case, unless it is reachable in normal use.
- Code the pull request did not change.
- A product or design choice the description or a comment says is
  deliberate.
- Anything typecheck, lint, or tests in CI already catch.

## How to comment

One issue per comment, on the changed line: what goes wrong, for which input
or state, and what the user or caller then sees, citing `path:line` for code
elsewhere. Add a suggestion only when applying it alone fixes the issue. No
praise, no summary of the change.

## Ignore

These files are generated or fixtures; skip them:

- `vercel.json` rewrites
- `apps/web/server/api-rewrites.json`
- `packages/*/fixtures/**`
- `packages/database/migrations/**/snapshot.json`
- `CHANGELOG.md`
- `pnpm-lock.yaml`
