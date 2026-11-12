// failure-notice-model.test.ts -- the offline notice said once a stretch however many writes fail under it, a refusal always said anew, and nothing left standing for an account that is gone.

import { describe, expect, it } from "vitest";
import {
  NO_NOTICE,
  NOTICE_KIND,
  noticeAsked,
  noticeCleared,
  noticeGone,
  noticeOnline,
} from "./failure-notice-model.js";

const OFFLINE = { kind: NOTICE_KIND.OFFLINE, words: "You're offline." } as const;

const REFUSED = {
  kind: NOTICE_KIND.REFUSED,
  words: "The task could not be pinned. Try again.",
} as const;

describe("the failure notice", () => {
  it("says the phone is offline once a stretch, even after that notice went, and again once it was back online", () => {
    const said = noticeAsked(NO_NOTICE, OFFLINE);
    const gone = noticeGone(said, said.serial);
    expect(noticeAsked(gone, OFFLINE).shown).toBeUndefined();
    const back = noticeOnline(gone);
    expect(noticeAsked(back, OFFLINE).shown?.words).toBe(OFFLINE.words);
  });

  it("says a refusal anew even in the same words, replacing what stood", () => {
    const first = noticeAsked(noticeAsked(NO_NOTICE, OFFLINE), REFUSED);
    const again = noticeAsked(first, REFUSED);
    expect(again.shown).not.toBe(first.shown);
    expect(again.shown?.words).toBe(REFUSED.words);
  });

  it("lets a refusal and its Try again go once the account is gone, and says the next one", () => {
    const said = noticeAsked(NO_NOTICE, { ...REFUSED, retry: () => undefined });
    const cleared = noticeCleared(said);
    expect(cleared.shown).toBeUndefined();
    expect(noticeAsked(cleared, REFUSED).shown?.serial).toBeGreaterThan(said.serial);
  });
});
