// run-secrets.ts -- the secrets and the database address one run of the suite shares between its local server and its workers' fixtures.

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * The variable the run's secrets ride in, from the runner that made them to
 * every worker it spawns. Note that they cannot be made where they are read,
 * because Playwright loads the config again in each worker, and a worker
 * that made its own ring could not seal a key the server opens.
 */
const RUN_SECRETS_VARIABLE = "APP_E2E_RUN_SECRETS";

/**
 * Where the suite's Postgres writes its connection string, relative to the
 * suite's folder, for a server started after it to read (`DATABASE_URL`
 * and `DATABASE_URL_UNPOOLED` alike). The folder is gitignored scratch, and
 * the file exists only while the database runs.
 */
export const DATABASE_URL_FILE = ".build/database-url";

/** The same file by its absolute path, for a fixture whatever the folder it runs in. */
export const DATABASE_URL_PATH = fileURLToPath(new URL(`../${DATABASE_URL_FILE}`, import.meta.url));

/** The secrets the local server is started with and the fixtures read. */
export interface RunSecrets {
  readonly BETTER_AUTH_SECRET: string;
  readonly CRON_SECRET: string;
  /** The encryption ring's one key: `1:` and 32 random bytes, the shape `PROVIDER_KEY_ENCRYPTION_KEYS` takes. */
  readonly PROVIDER_KEY_ENCRYPTION_KEYS: string;
}

/** A fresh random secret, in base64. */
function secret(): string {
  return randomBytes(32).toString("base64");
}

/**
 * The run's secrets: made new by the runner as it first loads the config,
 * so none is committed or outlives the run, and read back from its
 * environment by every worker, which inherits it.
 */
function runSecrets(): RunSecrets {
  const standing = process.env[RUN_SECRETS_VARIABLE];

  if (standing !== undefined) {
    // SAFETY: only this function writes the variable, as the JSON of a `RunSecrets`, and a worker inherits it from the runner unchanged.
    return JSON.parse(standing) as RunSecrets;
  }

  const made: RunSecrets = {
    BETTER_AUTH_SECRET: secret(),
    CRON_SECRET: secret(),
    PROVIDER_KEY_ENCRYPTION_KEYS: `1:${secret()}`,
  };

  process.env[RUN_SECRETS_VARIABLE] = JSON.stringify(made);

  return made;
}

export const RUN_SECRETS = runSecrets();
