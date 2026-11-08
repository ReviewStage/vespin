-- Expand step of dropping the agent's "seen_at" and the sandbox terminal lease's "held_until": nothing this
-- deployment runs reads or writes either, since a sandbox stops five idle minutes after its last touch and
-- nothing holds it or keeps a cloud runner warm by when its agent was last on screen. Note that both columns
-- stay one deployment longer, because a build migrates while the deployment before it still serves and
-- Drizzle names every declared column in an insert; a later release's migration drops them
-- (apps/web/server/README.md, "Dropping a column ... takes two deployments"). "seen_at" is nullable, so this
-- deployment's agent inserts, which name it no longer, still succeed while it stands; the agent table's
-- capture renders as it did, since its update trigger never named an ignored column. "held_until" is not, and
-- this deployment's credential claim inserts a lease row without it, so it is made nullable here; the release
-- still serving reads a null as no hold, and its write's greatest() of a null and its instant is its instant.
-- The lease table is small, so its lock is held for a catalog write alone, and given up rather than queued.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "sandbox_terminal_lease" ALTER COLUMN "held_until" DROP NOT NULL;
