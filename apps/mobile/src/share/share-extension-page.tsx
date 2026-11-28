/**
 * share-extension-page.tsx -- the share sheet's page: the app's own share page, run in the share extension with no host, on the snapshot the app left, what was shared laid into its field, and each place ticked sent under the access token read as it sends.
 *
 * The extension's Swift stands the bar (`share-extension/ShareViewController.swift`):
 * the page hands it the bar's words and hears its search through
 * `ExtensionBar`. What was shared lands in the field as its pills, the link
 * as its chip and each picture as its thumbnail's, drawn from the JPEG the
 * extension wrote. Send reads the token then and only then, sends each place
 * ticked as the app's page does (`@repo/features/ios-share-send`), through
 * the service's own routes (`ios-share-extension.ts`), and ends the sheet
 * once every place took it. Where any did not, or no token stood, the share
 * is kept as a draft naming the places it did not reach, its pictures beside
 * it, which the app opens the page on again the next time it comes forward
 * (`src/share-sheet.ts`), and the page says so and sends nothing more, since
 * the app's own send of the draft is the one that goes. A task New task made
 * is told in a notification whose tap opens it.
 */

import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import { CLIENT_PLATFORM } from "@repo/features/client-identity";
import {
  keptShare,
  SHARE_EXTENSION_WORDS,
  type SharedField,
  type SharedPicture,
  sharedField,
  sharedPicturesIn,
  shareStartedNotice,
} from "@repo/features/ios-share-extension";
import { SHARE_NEW_TASK_ID, SHARE_PAGE_WORDS } from "@repo/features/ios-share-page-model";
import { shareSendsOf } from "@repo/features/ios-share-send";
import {
  SHARE_DRAFT_PICTURE_FILES,
  type ShareSnapshotRead,
  shareDraftJson,
  shareSnapshotRead,
} from "@repo/features/ios-share-wire";
import type { CaretAtWord, ComposerPills, PillFieldHandle } from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { shareExtensionModule } from "./share-extension-module.js";
import { sendFromExtension } from "./share-extension-send.js";
import { SharePage, type SharePageBarProps } from "./share-page.js";

/** Where the page stands: reading what it needs, ready to send, sending, or done with the share, kept for the app. */
const PAGE_PHASE = {
  READING: "reading",
  READY: "ready",
  SENDING: "sending",
  KEPT: "kept",
} as const;

type PagePhase = (typeof PAGE_PHASE)[keyof typeof PAGE_PHASE];

/** The page's bar, which the extension's Swift draws: it is handed the bar's words once, and the search's words as they change. */
function ExtensionBar({ onSearch }: SharePageBarProps) {
  useEffect(() => {
    void shareExtensionModule.setBar(
      SHARE_PAGE_WORDS.TITLE,
      SHARE_PAGE_WORDS.SEARCH,
      SHARE_PAGE_WORDS.CANCEL,
    );
    const listening = shareExtensionModule.addListener("onSearch", ({ text }) => onSearch(text));

    return () => listening.remove();
  }, [onSearch]);

  return null;
}

/** `pictures` read as the attachments they send, or none where one could not be read. */
async function attachmentsOf(
  pictures: readonly SharedPicture[],
): Promise<readonly AgentAttachment[] | undefined> {
  const read = await Promise.all(pictures.map(({ file }) => shareExtensionModule.picture(file)));

  return read.every((data) => data !== null)
    ? pictures.map(({ name }, index) => ({
        name,
        mediaType: AGENT_ATTACHMENT_TYPE.JPEG,
        data: read[index] ?? "",
      }))
    : undefined;
}

/** Where New task starts: the workspace the places were read for, else the one the phone works in, and the repository a task there starts in first. */
function newTaskPlace(snapshot: ShareSnapshotRead) {
  const workspaceId =
    snapshot.destinations?.workspaceId ??
    snapshot.chosenWorkspaceId ??
    snapshot.workspaces[0]?.id ??
    "";

  const repository = snapshot.workspaces.find((each) => each.id === workspaceId)?.repositories[0];

  return { workspaceId, repository };
}

/** The field's pills over what was shared: each picture's marker drawn as its thumbnail's pill, from its file. */
function useSharedPills(pictures: readonly SharedPicture[]): ComposerPills {
  const field = useRef<PillFieldHandle>(null);
  const [, setAtWord] = useState<CaretAtWord | undefined>(undefined);

  return useMemo(
    () => ({
      field,
      onAtWord: setAtWord,
      files: new Set(pictures.map(({ name }) => name)),
      thumbnails: new Map(pictures.map(({ name, file }) => [name, file])),
    }),
    [pictures],
  );
}

/** The share sheet's page. */
export function ShareExtensionPage() {
  const [snapshot, setSnapshot] = useState<ShareSnapshotRead | undefined>(undefined);
  const [shared, setShared] = useState<SharedField>({ words: "", pictures: [] });
  const [words, setWords] = useState("");
  const [phase, setPhase] = useState<PagePhase>(PAGE_PHASE.READING);
  const [note, setNote] = useState<string | undefined>(undefined);
  const keys = useRef(new Map<string, string>());
  const [taskId] = useState(randomUUID);
  const pills = useSharedPills(shared.pictures);

  useEffect(() => {
    let standing = true;

    void Promise.all([shareExtensionModule.snapshot(), shareExtensionModule.sharedItems()]).then(
      ([json, items]) => {
        if (!standing) return;
        const read = json === null ? undefined : shareSnapshotRead(json);

        const field = sharedField({
          texts: items.texts ?? [],
          links: items.links ?? [],
          title: items.title,
          pictures: items.pictures ?? [],
        });

        setSnapshot(read);
        setShared(field);
        setWords(field.words);
        setPhase(PAGE_PHASE.READY);

        if (read === undefined) setNote(SHARE_EXTENSION_WORDS.SIGNED_OUT);
        else if ((items.leftOut ?? 0) > 0) setNote(SHARE_EXTENSION_WORDS.LEFT_OUT);
      },
    );

    // Note that the sheet's cold start is measured to the first frame the page drew, its bar and list before what was shared lands.
    requestAnimationFrame(() => void shareExtensionModule.drawn());

    return () => {
      standing = false;
    };
  }, []);

  const keyOf = (to: string) => {
    const kept = keys.current.get(to) ?? randomUUID();
    keys.current.set(to, kept);

    return kept;
  };

  // Note that the field keeps its words while the writes are out, so a send that did not go leaves them as they were.
  const send = async (to: readonly string[], sent: string) => {
    if (snapshot === undefined) return;
    const pictures = sharedPicturesIn(sent, shared.pictures);
    const attachments = await attachmentsOf(pictures);

    if (attachments === undefined) {
      setNote(SHARE_EXTENSION_WORDS.NOT_KEPT);
      setPhase(PAGE_PHASE.READY);

      return;
    }

    const place = newTaskPlace(snapshot);

    const sends = shareSendsOf({
      to,
      rows: snapshot.destinations?.rows ?? [],
      text: sent,
      attachments,
      keyOf,
      newTask: { taskId, ...place },
    });

    // Note that the token is read here, as the share is sent, and handed to nothing but the send.
    const token = (await shareExtensionModule.accessToken()) ?? undefined;

    const { failed, started } = await sendFromExtension(sends, token, {
      origin: snapshot.service.origin,
      client: { platform: CLIENT_PLATFORM.IOS, version: shareExtensionModule.appVersion },
    });

    if (started !== undefined) {
      const notice = shareStartedNotice(started);
      await shareExtensionModule.notify(notice.id, notice.title, notice.body, notice.payload);
    }

    if (failed.length === 0) {
      await shareExtensionModule.finish();

      return;
    }

    // Note that the draft carries each place's key, and New task's id, so the app's send of a write that landed unanswered here is the same write, never a second.
    const share = keptShare(sent, shared.pictures);

    const draft = shareDraftJson({
      accountId: snapshot.accountId,
      prompt: share.words,
      ...(share.pictures.length === 0
        ? undefined
        : { pictures: SHARE_DRAFT_PICTURE_FILES.slice(0, share.pictures.length) }),
      ...(place.workspaceId === "" ? undefined : { workspaceId: place.workspaceId }),
      ...(place.repository === undefined ? undefined : { repository: place.repository }),
      destinations: failed,
      keys: Object.fromEntries(failed.map((each) => [each, keyOf(each)])),
      ...(failed.includes(SHARE_NEW_TASK_ID) ? { taskId } : undefined),
      keptAt: Date.now(),
    });

    const kept = await shareExtensionModule.keepDraft(
      draft,
      share.pictures.map(({ file }) => file),
    );

    setNote(kept ? SHARE_EXTENSION_WORDS.kept(failed.length) : SHARE_EXTENSION_WORDS.NOT_KEPT);
    setPhase(kept ? PAGE_PHASE.KEPT : PAGE_PHASE.READY);
  };

  const onSend = (to: readonly string[], sent: string) => {
    if (phase !== PAGE_PHASE.READY || snapshot === undefined) return false;
    setPhase(PAGE_PHASE.SENDING);
    setNote(undefined);
    void send(to, sent).catch(() => {
      // Note that nothing of what failed is logged, since a request's failure may name its headers.
      setNote(SHARE_EXTENSION_WORDS.NOT_KEPT);
      setPhase(PAGE_PHASE.READY);
    });

    return false;
  };

  return (
    <SharePage
      Bar={ExtensionBar}
      destinations={snapshot?.destinations}
      words={words}
      onWords={setWords}
      pills={pills}
      holdsPictures={shared.pictures.length > 0}
      held={phase !== PAGE_PHASE.READY || snapshot === undefined}
      note={note}
      onSend={onSend}
      onCancel={() => undefined}
    />
  );
}
