#!/usr/bin/env bash
set -euo pipefail

# Copies every Manager's chat from before its rows were written out of its
# transcript into manager_chat_message, once, so the panel and iOS can draw
# a Manager's chat from its rows alone.
#
#   CRON_SECRET=<the deployment's own> scripts/backfill-manager-chats.sh [--dry-run] [--agent <id>] https://vespin.dev
#
# The backfill runs on the deployment itself
# (`packages/service/src/maintenance/manager-chat-backfill.ts`), a batch of
# Managers a request, under the deployment's CRON_SECRET; this asks for each
# batch in turn until the last and prints each batch's counts as it lands,
# then the totals: Managers read and changed, transcripts left unread,
# Managers that failed (logged on the deployment), and messages already
# standing, written, and moved into order. `--dry-run` writes nothing and
# prints what a run would do. `--agent` backfills one Manager alone, to try
# it on first. A run again writes nothing, since every message stands.
#
# Note that the bearer is handed to curl on its standard input, so the secret
# never stands in this machine's process list.

usage() {
    printf 'usage: CRON_SECRET=… %s [--dry-run] [--agent <id>] <deployment origin>\n' "$0" >&2
    exit 2
}

dry=0
agent=""
origin=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) dry=1; shift ;;
        --agent) [[ $# -ge 2 ]] || usage; agent="$2"; shift 2 ;;
        -*) usage ;;
        *) [[ -z "$origin" ]] || usage; origin="${1%/}"; shift ;;
    esac
done
[[ -n "$origin" ]] || usage
if [[ -z "${CRON_SECRET:-}" ]]; then
    printf 'error: CRON_SECRET must name the deployment'"'"'s own secret\n' >&2
    exit 2
fi
command -v jq >/dev/null || { printf 'error: jq is needed to read the answers\n' >&2; exit 2; }

query="dry=$dry"
[[ -z "$agent" ]] || query="$query&agent=$agent"
after=""
totals='{"managers":0,"changed":0,"unreadable":0,"failed":0,"standing":0,"written":0,"moved":0}'

while :; do
    url="$origin/api/maintenance/manager-chat-backfill?$query"
    [[ -z "$after" ]] || url="$url&after=$after"
    answer="$(printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
        curl --fail-with-body --silent --show-error --request POST --header @- "$url")"
    printf '%s\n' "$answer"
    totals="$(jq -c --argjson t "$totals" \
        '. as $b | $t | with_entries(.value += ($b[.key] // 0))' <<<"$answer")"
    after="$(jq -r '.next // empty' <<<"$answer")"
    [[ -n "$after" ]] || break
done

printf 'totals (%s): %s\n' "$([[ $dry == 1 ]] && echo dry run || echo written)" "$totals"
