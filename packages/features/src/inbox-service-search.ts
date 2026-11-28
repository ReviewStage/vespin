/**
 * inbox-service-search.ts -- an Inbox search asked of the service past the items a client holds: where it is asked from, the words it sends, the host's act that asks, and the pause-then-ask every client's search field mounts.
 *
 * A client's own search filters the items its host holds, and answers at
 * once. The host holds only the account's open items and its feed's
 * window, so the words a search field holds are asked of the service too,
 * once typing pauses (`INBOX_SEARCH_PAUSE_MILLIS`), through the host's
 * `AGENTS_INBOX_SEARCH`. The host reads the items the service's search
 * finds (`INBOX_SEARCH_READ`) and holds them for the place that asked, by
 * the place (`LIVE_READ.INBOX_FOUND`), until the place's words change or
 * clear, so each client's own filter then finds them beside the items it
 * holds, under the scope it shows, and opens them by id.
 *
 * Each place a search is asked from (`INBOX_SEARCH_PLACE`) holds one search
 * out on the service at a time: newer words wait in the host until the one
 * out answers, only the latest kept, so typing never stacks searches on the
 * service, and an older answer never draws over a newer one. It holds no React and no DOM: each client's hook (the
 * panel's `use-inbox-service-search.ts`, and the iOS app's) mounts one
 * `inboxServiceSearch` for its place and hands it the host's act.
 */

import { Schema as EffectSchema } from "effect";
import { AGENT_CALL_FAILURE } from "./agent-view.js";
import { INBOX_SEARCH_QUERY_MAX_CHARS } from "./inbox-live.js";

/**
 * Where an Inbox search is asked from, each holding its own search and the
 * items it found: an Inbox's own search field (the desktop's and web's list
 * head, the phone's Inbox tab), and a search across everything (⌘K, the
 * phone's Search tab). Each draws only its own found items.
 */
export const INBOX_SEARCH_PLACE = {
  INBOX: "inbox",
  EVERYTHING: "everything",
} as const;

export type InboxSearchPlace = (typeof INBOX_SEARCH_PLACE)[keyof typeof INBOX_SEARCH_PLACE];

/** The fewest characters an Inbox search asks the service for, so a first letter reads nothing. */
export const INBOX_SEARCH_MIN_CHARS = 2;

/** How long typing pauses before an Inbox search's words are asked of the host, so a word typed out reads once rather than once a letter. */
export const INBOX_SEARCH_PAUSE_MILLIS = 250;

/** The words a search field holding `typed` asks of the service (`AGENTS_INBOX_SEARCH`): trimmed and cut to what the service reads, or none where fewer than `INBOX_SEARCH_MIN_CHARS` stand. */
export function serviceInboxSearchQuery(typed: string): string | undefined {
  const words = typed.trim().slice(0, INBOX_SEARCH_QUERY_MAX_CHARS);

  return words.length < INBOX_SEARCH_MIN_CHARS ? undefined : words;
}

/**
 * A place's Inbox search, as a client asks the host for it: the place, and
 * the words its field holds; no words lets go of the place's search and
 * the items it found.
 */
export const agentInboxSearchParamsSchema = EffectSchema.Struct({
  place: EffectSchema.Literals(Object.values(INBOX_SEARCH_PLACE)),
  query: EffectSchema.optionalKey(
    EffectSchema.String.check(
      EffectSchema.isMinLength(INBOX_SEARCH_MIN_CHARS),
      EffectSchema.isMaxLength(INBOX_SEARCH_QUERY_MAX_CHARS),
    ),
  ),
});

export type AgentInboxSearchParams = typeof agentInboxSearchParamsSchema.Type;

/**
 * A place's search, as the client hears it: nothing more once the service
 * answered its words and the items found are drawn, or its search was let
 * go; that the service did not answer; or that newer words from the place
 * replaced these (`replaced`), before they were asked or while they were
 * out, so their answer, whatever it found, is drawn nowhere. Note that a
 * replaced search found nothing only in that it is no longer asked: the
 * place's newer words are still to be answered. The items reach the
 * client on app state (`LIVE_READ.INBOX_FOUND`), never here. The failure
 * and the replacing are tried first, since an object holding either is an
 * object of no fields too.
 */
export const agentInboxSearchAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ failure: EffectSchema.Literal(AGENT_CALL_FAILURE.UNANSWERED) }),
  EffectSchema.Struct({ replaced: EffectSchema.Literal(true) }),
  EffectSchema.Struct({}),
]);

export type AgentInboxSearchAnswer = typeof agentInboxSearchAnswerSchema.Type;

/** What a client's search field holds of its place's search: the words it tells, its letting go, whether the service's answer to its words is still to come, and a listener told as that flips. */
export interface InboxServiceSearch {
  /** Tells the search the words its field now holds; the same words again ask nothing. */
  readonly type: (typed: string) => void;
  /** Lets go of the place's search, as its screen goes; a `type` after it starts afresh. */
  readonly end: () => void;
  /** Whether the service's answer to the words now held is still to come, while typing pauses or the search is out, so a client never says nothing was found before it lands. */
  readonly searching: () => boolean;
  /** Hears each flip of `searching`; answers the way to stop hearing it. */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface InboxServiceSearchOptions {
  /** Where the search is asked from, which the host holds its found items under. */
  readonly place: InboxSearchPlace;
  /** The host's `AGENTS_INBOX_SEARCH`, as the client calls it. */
  readonly ask: (params: AgentInboxSearchParams) => Promise<AgentInboxSearchAnswer>;
}

/**
 * One place's search of the service, asked through `ask` once the words
 * typed have stood for `INBOX_SEARCH_PAUSE_MILLIS`, so a run of keys asks
 * once, for its last words. Words fewer than `INBOX_SEARCH_MIN_CHARS`, and
 * `end`, let go of what the place asked, once, where it asked anything.
 * Note that an answer counts only for the words it was asked for, since the
 * host answers a search newer words replaced too (`replaced`), and that a
 * refusal or a throw counts as an answer, so `searching` never stands for
 * good.
 */
export function inboxServiceSearch(options: InboxServiceSearchOptions): InboxServiceSearch {
  const { place, ask } = options;
  const listeners = new Set<() => void>();
  /** The words the field holds, as they are asked; none where too few stand. */
  let words: string | undefined;
  /** The pause before `words` are asked, while it runs. */
  let pause: ReturnType<typeof setTimeout> | undefined;
  /** The words last asked, which the host holds the found items of until they are let go. */
  let asked: string | undefined;
  let searching = false;

  const flip = (next: boolean): void => {
    if (searching === next) return;
    searching = next;

    for (const listener of listeners) listener();
  };

  const letGo = (): void => {
    if (asked === undefined) return;
    asked = undefined;
    // Note that a letting go nobody waits on may fail unheard: the host lets the place go at a sign-out too.
    ask({ place }).catch(() => undefined);
  };

  const askNow = (query: string): void => {
    pause = undefined;
    asked = query;

    const settled = () => {
      if (words === query && pause === undefined) flip(false);
    };

    ask({ place, query }).then(settled, settled);
  };

  const stop = (): void => {
    if (pause !== undefined) clearTimeout(pause);
    pause = undefined;
  };

  return {
    type: (typed) => {
      const next = serviceInboxSearchQuery(typed);

      if (next === words) return;
      words = next;
      stop();

      if (next === undefined) {
        letGo();
        flip(false);

        return;
      }

      flip(true);
      pause = setTimeout(() => askNow(next), INBOX_SEARCH_PAUSE_MILLIS);
    },
    end: () => {
      stop();
      words = undefined;
      letGo();
      flip(false);
    },
    searching: () => searching,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}
