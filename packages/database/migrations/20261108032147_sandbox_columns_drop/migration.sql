-- Contract step of dropping the agent's "seen_at" and the sandbox terminal lease's "held_until": nothing has
-- declared, read, or written either since 20261108010008_sandbox_holds_undeclare (#7578), which is live, and no
-- synced table's capture names "seen_at". "agent" is written on every turn of an agent, so it is locked first, as
-- 20261106235123_token_pull_request_poll_drop locks it, under a short lock_timeout of its own, letting the lock
-- go and backing off holding none between attempts.
SET LOCAL statement_timeout = '150s';
--> statement-breakpoint
DO $$
DECLARE
	attempt int := 0;
	deadline timestamptz := clock_timestamp() + interval '2 minutes';
BEGIN
	LOOP
		attempt := attempt + 1;
		BEGIN
			PERFORM set_config('lock_timeout', least(100 * attempt, 500) || 'ms', true);
			LOCK TABLE "agent", "sandbox_terminal_lease" IN ACCESS EXCLUSIVE MODE;
			RETURN;
		EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
			IF clock_timestamp() > deadline THEN
				RAISE;
			END IF;
		END;
		PERFORM pg_sleep(least(0.2 * attempt, 3) * (0.5 + random()));
	END LOOP;
END
$$;
--> statement-breakpoint
-- With the lock held, no statement below waits on another; one that does gives up rather than
-- queueing live traffic behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "agent" DROP COLUMN IF EXISTS "seen_at";
--> statement-breakpoint
ALTER TABLE "sandbox_terminal_lease" DROP COLUMN IF EXISTS "held_until";
--> statement-breakpoint
-- Note that the settings go back with SET LOCAL rather than RESET, because RESET sets the session's value to the
-- server's default, which outlives this transaction and takes away the runner's own lock_timeout from every later
-- migration of the run. The 5s above is that bound already, so it stands.
SET LOCAL statement_timeout TO DEFAULT;
