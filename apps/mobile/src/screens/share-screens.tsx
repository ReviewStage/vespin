// share-screens.tsx -- the share page the app opens a kept share draft on, its words, pictures and places as the share sheet left them, sent through the app's own acts.

import { SHARE_PAGE_WORDS } from "@repo/features/ios-share-page-model";
import { shareSendsOf } from "@repo/features/ios-share-send";
import { randomUUID } from "expo-crypto";
import { useNavigation, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StackShareBar } from "../share/share-bar.js";
import { SharePage } from "../share/share-page.js";
import { useShareSend } from "../share/use-share-send.js";
import { useShareDestinations } from "../share-sheet.js";
import { useAttachedPictures } from "../use-attached-pictures.js";
import { usePillField } from "../use-pill-field.js";

/** A kept share draft, as its route hands it over. */
export interface ShareDraftOpened {
  readonly prompt: string;
  /** The places it ticked, by their ids. */
  readonly destinations: readonly string[];
  /** Its pictures' files in the App Group. */
  readonly pictures: readonly string[] | undefined;
  /** The repository New task starts in, as the sheet picked it. */
  readonly repository: string | undefined;
}

/**
 * The share page on a kept draft: the places it ticked ticked again, its
 * words and pictures in the field. Each place is sent under a key minted
 * once for the page, and New task's task id too, so Send pressed again after
 * a write that did not go sends the rest and never a second of one that
 * did. Every write gone, the sheet closes, where it still stands in front;
 * otherwise the page says how many did not go and keeps the words.
 */
export function ShareDraftScreen({ draft }: { readonly draft: ShareDraftOpened }) {
  const router = useRouter();
  const navigation = useNavigation();
  const destinations = useShareDestinations();
  const send = useShareSend();
  const [words, setWords] = useState(draft.prompt);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const pictures = useAttachedPictures(setNote, draft.pictures);
  const field = usePillField(words, setWords, pictures);
  const keys = useRef(new Map<string, string>());
  const [taskId] = useState(randomUUID);

  const keyOf = (to: string) => {
    const kept = keys.current.get(to) ?? randomUUID();
    keys.current.set(to, kept);

    return kept;
  };

  // Note that the field keeps its words while the writes are out, so a send that did not go leaves them to send again.
  const onSend = (to: readonly string[], sent: string) => {
    if (destinations === undefined || sending || pictures.opening) return false;

    const sends = shareSendsOf({
      to,
      rows: destinations.rows,
      text: sent,
      attachments: pictures.files ?? [],
      keyOf,
      newTask: { taskId, workspaceId: destinations.workspaceId, repository: draft.repository },
    });

    setSending(true);
    setNote(undefined);
    void send(sends).then((failed) => {
      setSending(false);

      // Note that the sheet closes only while it still stands in front, so a send that lands after the reader closed it, or opened something over it, moves nothing of theirs.
      if (failed.length === 0) {
        if (navigation.isFocused()) router.back();

        return;
      }

      setNote(SHARE_PAGE_WORDS.notSent(failed.length));
    });

    return false;
  };

  return (
    <SharePage
      Bar={StackShareBar}
      destinations={destinations}
      words={words}
      onWords={setWords}
      pills={field.pills}
      holdsPictures={pictures.attached.length > 0}
      initialTicked={draft.destinations}
      note={note ?? pictures.refusal}
      onSend={onSend}
      onCancel={() => router.back()}
    />
  );
}
