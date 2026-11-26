/**
 * The scheduled sweep's bounds, on their own so the modules every function
 * shares can read them without the sweep. `HostedEnvironment` names the cron
 * secret and `function-durations` the sweep's path and cap, and both are
 * inlined into every route's bundle; a value import of the sweep's group
 * from here would carry its graph into every function bundle, since esbuild
 * follows a value import where it would erase a type one. So the constants
 * live in this leaf and the sweep imports them like everyone else.
 */

/** Where Vercel's scheduler calls the sweep, fixed here so its schedule can be checked against it. */
export const MAINTENANCE_SWEEP_PATH = "/api/maintenance/sweep";

/** Where Vercel's scheduler calls the daily workspace drive cleanup (`workspace-drive-cleanup-app.ts`). */
export const WORKSPACE_DRIVE_CLEANUP_PATH = "/api/maintenance/workspace-drives";

/** The rotation's rewrap of every stored provider key (`provider-key-rewrap.ts`), asked by hand under the same secret. */
export const MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH = "/api/maintenance/provider-keys-rewrap";

export const CRON_ENVIRONMENT = {
  /**
   * Vercel sends this as the bearer on every scheduled call once it is set.
   * It guards the maintenance routes alone, the sweep, the workspace drive
   * cleanup, and the rewrap and the schedules' backfill asked by hand.
   */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const MAINTENANCE_SWEEP = {
  /**
   * The function duration the sweep's bundle declares. Note that it is the
   * Fluid default every Start's function runs under rather than the minute
   * the cron calls on, because an agent the sweep starts (an automation's
   * run, a wakeup, a queued message) launches past the sweep's answer under
   * this same bound (`after-response.ts`), and a sandbox can take most of a
   * minute to open: a launch cut off by the bound dies with nothing to say
   * so, and its agent reads as one that never started.
   */
  MAX_DURATION_SECONDS: 300,
  /** The schedule the root `vercel.json` calls the sweep on, which its Sentry monitor expects a check-in against. */
  CRONTAB: "* * * * *",
} as const;

/**
 * The purge of attachments' objects from the Blob store (`attachment-blob-purge.ts`).
 * Note that a delete is free and outside the store's 75 advanced operations
 * a second on Pro, so the bound is the sweep's own minute: ten requests a
 * sweep, one after another, keep well inside it and clear a deleted
 * workspace's thousand objects a minute.
 */
export const ATTACHMENT_BLOB_PURGE = {
  /** How many tombstones one sweep takes at most. */
  TOMBSTONES_PER_SWEEP: 1_000,
  /** How many pathnames one delete request names. */
  PATHNAMES_PER_DELETE: 100,
} as const;

/**
 * The one-off move of the journal's images kept as `data:` URLs into Blob
 * (`storage/journal-image-move.ts`). Note that a row is read whole, up to a
 * few MB of base64, and each new picture is written and read back, so a few
 * rows a sweep keep well inside its minute; the 73 rows production queued
 * move in about a quarter of an hour.
 */
export const JOURNAL_IMAGE_MOVE = {
  /** How many queued rows one sweep takes at most. */
  ROWS_PER_SWEEP: 5,
} as const;
