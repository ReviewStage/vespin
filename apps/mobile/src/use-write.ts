/**
 * use-write.ts -- the one way a screen sends a write a person pressed for: what went buzzes as the system does, and what did not says why, in the failure notice with a Try again, or in place where the screen holds its words, and, while the phone is offline, as the one offline notice rather than once for each write.
 *
 * Every press that changes something (a status, a pin, a read mark, a
 * reminder, a send, a merge, an answer, a start, a sign-out) goes through
 * `useWrite`, so no screen can leave a refusal silent: a rejection the host
 * drew a sentence for says that sentence (`actRefusalSentence`, the read the
 * panel's act door makes), an answer the act refuses says what the caller
 * reads of it, and any other failure says the panel's one fixed sentence
 * (`ACT_UNREACHED_WORDS`), never its own text, which goes to the log. While
 * the service cannot be reached (`selectLiveMark`), a write that got no
 * answer says the panel's offline hint once for the stretch
 * (`@repo/ui-native`'s `FailureNotices`). A read on open, a follow, or a
 * report nobody pressed for goes quietly and does not come here.
 */

import { ACT_UNREACHED_WORDS, offlineRefusedWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  LIVE_MARK,
  LIVE_MARK_WORDS,
  type LiveMark,
  selectLiveMark,
} from "@repo/host/app-state-reads";
import { actRefusalSentence } from "@repo/host/contract";
import { BUZZ, type Buzz, buzz, NOTICE_KIND, useFailureNotices } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";

/** How a write's caller reads what came back, and where its refusal is said. */
interface WriteSaying<Answer> {
  /** What a refusal in the answer says; none where the answer is the write gone. None given, every answer is the write gone. */
  readonly refused?: ((answer: Answer) => string | undefined) | undefined;
  /** What a write that got no answer, and no sentence of the host's, says in place of the fixed sentence, such as a send's own words for it. */
  readonly unanswered?: string | undefined;
  /** Whether the notice offers Try again, which sends the write again as it was. */
  readonly retry?: boolean | undefined;
  /** The buzz a write that went plays; none for one that goes quietly, such as a read mark. */
  readonly went?: Buzz | undefined;
  /**
   * Says the refusal in place, beside what the write came from, rather than
   * in the notice, such as a send whose words go back into its field; it is
   * told the refusal's words, the offline hint among them, and the error
   * buzz still plays.
   */
  readonly inPlace?: ((words: string) => void) | undefined;
}

/** Sends `act`, says what came back, and answers whether it went. Never rejects. */
export type Write = <Answer>(
  act: () => PromiseLike<Answer>,
  saying?: WriteSaying<Answer>,
) => Promise<boolean>;

/** The marks that say the service cannot be reached now. */
const OFFLINE_MARKS: ReadonlySet<LiveMark | undefined> = new Set([
  LIVE_MARK.MAC_OFFLINE,
  LIVE_MARK.SERVICE_OFFLINE,
]);

/**
 * Lets the offline notice go once the service answers again, so the next
 * stretch offline is said anew, and says how many changes made offline the
 * service refused once they were sent again, as the panel's toast does,
 * each taken back where it was drawn; the count is cleared as it is said,
 * since this phone's host keeps its own. The root mounts it once, over
 * every screen.
 */
export function useOfflineNotice(): void {
  const notices = useFailureNotices();
  const acts = useHostActs();
  const { data: mark } = useQuery({ ...appStateQuery, select: selectLiveMark });
  const { data: refused = 0 } = useQuery({
    ...appStateQuery,
    select: (state) => state.network.offlineRefused ?? 0,
  });
  const offline = OFFLINE_MARKS.has(mark);
  useEffect(() => {
    if (!offline) notices.online();
  }, [offline, notices]);
  useEffect(() => {
    if (refused === 0) return;
    buzz(BUZZ.ERROR);
    notices.say({ kind: NOTICE_KIND.REFUSED, words: offlineRefusedWords(refused) });
    acts[ACT_KIND.TASKS_OFFLINE_REFUSED_CLEAR]().catch((error: unknown) =>
      console.error("The count of changes refused offline was not cleared.", error),
    );
  }, [refused, notices, acts]);
}

/** The write door every press goes through; see the module's head. */
export function useWrite(): Write {
  const notices = useFailureNotices();
  const { data: mark } = useQuery({ ...appStateQuery, select: selectLiveMark });
  // Note that the mark is read as the answer lands, not as the press was made, since a write waits on the service for as long as its call does.
  const markNow = useRef(mark);
  useEffect(() => {
    markNow.current = mark;
  }, [mark]);
  const write: Write = useCallback(
    <Answer>(act: () => PromiseLike<Answer>, saying: WriteSaying<Answer> = {}) => {
      const send = (): Promise<boolean> => {
        const failed = (words: string, unreached: boolean): false => {
          buzz(BUZZ.ERROR);
          const now = markNow.current;
          const offline = unreached && now !== undefined && OFFLINE_MARKS.has(now);
          const said = offline ? LIVE_MARK_WORDS[now].hint : words;
          if (offline) notices.say({ kind: NOTICE_KIND.OFFLINE, words: said });
          if (saying.inPlace !== undefined) saying.inPlace(said);
          else if (!offline) {
            notices.say({
              kind: NOTICE_KIND.REFUSED,
              words,
              retry: saying.retry === true ? () => void send() : undefined,
            });
          }
          return false;
        };
        let started: PromiseLike<Answer>;
        try {
          started = act();
        } catch (thrown) {
          started = Promise.reject(thrown);
        }
        return Promise.resolve(started).then(
          (answer) => {
            const words = saying.refused?.(answer);
            if (words !== undefined) return failed(words, false);
            if (saying.went !== undefined) buzz(saying.went);
            return true;
          },
          (cause: unknown) => {
            const sentence = actRefusalSentence(cause);
            if (sentence !== undefined) return failed(sentence, false);
            console.error("A write did not go.", cause);
            return failed(saying.unanswered ?? ACT_UNREACHED_WORDS, true);
          },
        );
      };
      return send();
    },
    [notices],
  );
  return write;
}
