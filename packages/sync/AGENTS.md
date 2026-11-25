# `@repo/sync`

## It knows nothing of the rest of the repository

The engine names no entity kind, no Gateway method, no composer, and no
feature's wire. A kind (`EntityKind`) and a write (`WriteDeclaration`) are
declared by their client in the host, beside the composer that reads them, and
a read hands the pool its confirmation (`Confirmation`) rather than the pool
importing how a read follows. **Its only dependencies are `effect` and
`@tanstack/db`**, and the dependency graph is what holds that: reaching a
workspace package would take a new line in `package.json`. Its tests alone
also reach TanStack DB's SQLite persistence core
(`@tanstack/db-sqlite-persistence-core`), to keep a stored kind on a real
database; the platform hands the persistence in (`PoolStore.collections`), so
nothing here imports it.

## It stays free of Node

The web app runs the host in a tab, and the host draws every row it holds from
this pool, so nothing here names a `node:` module, `Buffer`, or `process`.
`scripts/repository-checks.sh` walks into this package from the host's
browser doors and fails on one.

## A pool collection is never a TanStack transaction

Each kind is one collection only sync writes. A write is laid over it by the
pool itself, never as an optimistic transaction, because a persisting
transaction holds back every answer its collection is synced, which would
freeze every read of the kind behind one write. A collection held in memory
never truncates either, because there a truncate deletes every row and
inserts it again, moved or not. A stored kind's collection, kept on disk by
TanStack DB's persistence, is the one exception: the whole answer of the read
that answers every row is written as one truncate and its rows, which the
persistence takes as the authoritative set, and over which a live query hears
only the rows that moved.
