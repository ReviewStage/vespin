// failure-notice-model.test.ts -- the offline notice said once a stretch however many writes fail under it, and a refusal always said anew.

import { describe, expect, it } from "vitest";
import {
  NO_NOTICE,
  NOTICE_KIND,
  noticeAsked,
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
});
