# Upstream

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at commit
`13909c9e07590f5a85d93c62712259fe14a883f7` (Oct 13, 2026), by running that commit's
`skills/install-anti-slop/scripts/install.mjs` from the repository root, which copied
`skills/install-anti-slop/assets/anti-slop/` here unchanged.

Installed plugins, registered in the root `.oxlintrc.json`:

- `anti-slop`: `./tools/oxlint/anti-slop/index.ts`
- `anti-slop-effect`: `./tools/oxlint/anti-slop/effect/index.ts`

`@oxlint/plugins` is pinned at exactly the root `oxlint` version.

Local deviations:

- `package.json` here, which upstream does not ship, marks the plugin as ES modules so
  Node loads it without a module-type warning on every lint.
- Biome leaves this directory alone (`biome.json`), so the files stay as upstream wrote
  them and a later update diffs cleanly.

To update, follow upstream's `skills/install-anti-slop/references/update.md`.
