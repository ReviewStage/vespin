// feedback.tsx -- Settings' Send feedback, the panel's feedback form drawn natively: Feedback or Prompt, the words, up to the panel's number of screenshots from the photo picker, and whether to sign it, sent through the host as the panel sends a note.

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  draftSubmission,
  FEEDBACK_COPY,
  FEEDBACK_IMAGE_TYPE,
  FEEDBACK_KIND,
  FEEDBACK_KIND_CHOICES,
  FEEDBACK_LIMITS,
  FEEDBACK_WORDS,
  type FeedbackImage,
  type FeedbackKind,
  feedbackSignature,
  signatureLine,
} from "@repo/features/feedback";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  AttachRow,
  BUZZ,
  buzz,
  ConfirmAsk,
  GLYPH,
  glyphSymbol,
  ListSection,
  ScopePicker,
  Screen,
  SettingsForm,
  ToggleRow,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import {
  type AttachedPictures,
  type PictureBounds,
  useAttachedPictures,
} from "../../use-attached-pictures.js";
import { DISCARD_WORDS, useKeptWords } from "../../use-kept-words.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The names a flow finds the field and the + by. */
const TEST_IDS = { WORDS: "feedback-words", ATTACH: "feedback-attach" } as const;

/**
 * A note's screenshots: as many as the panel's, each under the endpoint's
 * bound for one, read at a lower quality than a message's picture, since a
 * phone's screenshot must fit that bound without the panel's re-encode.
 */
const FEEDBACK_PICTURES: PictureBounds = {
  most: FEEDBACK_LIMITS.MAX_IMAGES,
  pictureBytes: FEEDBACK_LIMITS.IMAGE_MAX_BYTES,
  totalBytes: FEEDBACK_LIMITS.MAX_IMAGES * FEEDBACK_LIMITS.IMAGE_MAX_BYTES,
  quality: 0.5,
  full: FEEDBACK_WORDS.FULL,
};

/** No words yet, for either kind. */
const NO_WORDS: Readonly<Record<FeedbackKind, string>> = {
  [FEEDBACK_KIND.FEEDBACK]: "",
  [FEEDBACK_KIND.PROMPT]: "",
};

/** The screenshots a note carries, as the endpoint takes them: each a JPEG under the name it was attached as. */
function screenshotsOf(pictures: AttachedPictures): readonly FeedbackImage[] {
  return (pictures.files ?? []).map((file) => ({
    name: file.name,
    mediaType: FEEDBACK_IMAGE_TYPE.JPEG,
    base64: file.data,
  }));
}

/**
 * Send feedback, as the panel's dialog writes a note: its kind chosen at the
 * head, Feedback or Prompt, each kind keeping its own words and screenshots
 * while the page stands; the words, the screenshots under them, and Include
 * my name and email, the line under it saying who signs it or that it goes
 * unsigned. Send in the bar is lit once there are words and no dropped
 * picture is still being read; what it carries is exactly what the page
 * shows (`draftSubmission`). A send refused says why under the words and
 * keeps the note; one that went buzzes and takes off what it carried, and
 * goes back to Settings unless the page still holds a note: the other
 * kind's, or what was written or attached while it was out. Back, or a
 * swipe down of Settings, asks first while the page holds a note.
 */
export default function FeedbackScreen() {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const write = useWrite();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });

  const signature = feedbackSignature(
    account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined,
  );

  const [kind, setKind] = useState<FeedbackKind>(FEEDBACK_KIND.FEEDBACK);
  const [words, setWords] = useState(NO_WORDS);
  const [signed, setSigned] = useState(true);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  // Whether a send is out, read at the press itself.
  const out = useRef(false);
  // Whether the page still stands, since a note discarded while its send was out leaves a send that must not take the screen now in front back with it.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);
  // How many notes went, by which the field is drawn afresh once the words it held were sent.
  const [sends, setSends] = useState(0);
  const feedbackPictures = useAttachedPictures(setNote, undefined, FEEDBACK_PICTURES);
  const promptPictures = useAttachedPictures(setNote, undefined, FEEDBACK_PICTURES);
  const pictures = kind === FEEDBACK_KIND.FEEDBACK ? feedbackPictures : promptPictures;
  const message = words[kind];

  const drafted =
    Object.values(words).some((each) => each.trim() !== "") ||
    feedbackPictures.files !== undefined ||
    promptPictures.files !== undefined;

  const kept = useKeptWords(drafted);

  // What each kind holds now, for a send that answers renders after it began, since the other kind or an edit made meanwhile may still hold a note.
  const held = useRef({
    words,
    feedback: feedbackPictures.attached,
    prompt: promptPictures.attached,
    reading: feedbackPictures.reading || promptPictures.reading,
  });

  useEffect(() => {
    held.current = {
      words,
      feedback: feedbackPictures.attached,
      prompt: promptPictures.attached,
      reading: feedbackPictures.reading || promptPictures.reading,
    };
  });

  const send = () => {
    // Note that a second press before the first one's render is turned away by the ref, which state would not yet say.
    if (out.current || pictures.reading || message.trim() === "") return;

    if (message.trim().length > FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH) {
      setNote(FEEDBACK_WORDS.TOO_LONG);
      buzz(BUZZ.WARNING);

      return;
    }

    if (pictures.refusal !== undefined) {
      setNote(pictures.refusal);
      buzz(BUZZ.WARNING);

      return;
    }

    const draft = { message, images: screenshotsOf(pictures), signed };
    const sent = new Set(pictures.attached.map((picture) => picture.id));
    const detach = pictures.detach;
    out.current = true;
    setSending(true);
    setNote(undefined);

    // Note that a send refused says why under the words rather than in the notice, as the panel's dialog says it under its box.
    void write(
      () => acts[ACT_KIND.FEEDBACK_SEND]({ submission: draftSubmission(kind, draft, signature) }),
      {
        refused: (result) =>
          result.delivered ? undefined : (result.reason ?? FEEDBACK_WORDS.SEND_REFUSAL),
        unanswered: FEEDBACK_WORDS.SEND_REFUSAL,
        inPlace: setNote,
        went: BUZZ.SUCCESS,
      },
    ).then((went) => {
      out.current = false;
      setSending(false);

      if (!went) return;
      // Note that only what was sent is taken off: words changed while it was out, a picture added or still being read meanwhile, and the other kind's note all stay, and keep the page.
      const now = held.current;
      const other = kind === FEEDBACK_KIND.FEEDBACK ? FEEDBACK_KIND.PROMPT : FEEDBACK_KIND.FEEDBACK;
      const edited = now.words[kind] !== message;
      const added = now[kind].some((picture) => !sent.has(picture.id));
      const otherHeld = now.words[other].trim() !== "" || now[other].length > 0;

      for (const id of sent) detach(id);

      if (!edited) {
        setWords((current) => ({ ...current, [kind]: "" }));
        setSends((count) => count + 1);
      }

      // Note that a picture dropped while the send was out and still being read keeps the page too, so it lands where it can be seen.
      if (!standing.current || edited || added || otherHeld || now.reading) return;
      kept.release();
      router.back();
    });
  };

  const scopes = FEEDBACK_KIND_CHOICES.map((choice) => ({
    label: choice.label,
    selected: choice.value === kind,
    onPress: () => {
      setKind(choice.value);
      setNote(undefined);
    },
  }));

  return (
    <>
      <Stack.Screen options={{ title: FEEDBACK_WORDS.TITLE }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.SEND)}
          variant="prominent"
          tintColor={colors.ACCENT}
          accessibilityLabel={sending ? FEEDBACK_WORDS.SENDING : FEEDBACK_WORDS.SEND}
          disabled={sending || pictures.reading || message.trim() === ""}
          onPress={send}
        />
      </Stack.Toolbar>
      <ConfirmAsk
        title={DISCARD_WORDS.QUESTION}
        act={DISCARD_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={() => {
          // Note that the page stands no longer from the discard itself, since it stays mounted through its exit, and a send landing then must not go back from the screen in front.
          standing.current = false;
          kept.discard();
        }}
        onDismiss={kept.stay}
      />
      <Screen>
        <ScopePicker label={FEEDBACK_WORDS.KIND} scopes={scopes}>
          <SettingsForm>
            <ListSection footer={note}>
              {/* Note that each kind's field stands apart, so a change of kind shows that kind's own words, and is drawn afresh once its words were sent. */}
              <Fragment key={sends}>
                <WordsField
                  key={kind}
                  placeholder={FEEDBACK_COPY[kind].placeholder}
                  label={FEEDBACK_COPY[kind].field}
                  initialWords={message}
                  onWords={(typed) => setWords((held) => ({ ...held, [kind]: typed }))}
                  autoFocus
                  testId={TEST_IDS.WORDS}
                />
              </Fragment>
              <AttachRow
                pictures={pictures.attached}
                onAdd={pictures.attach}
                onDetach={pictures.detach}
                onDropPictures={pictures.drop}
                testId={TEST_IDS.ATTACH}
              />
            </ListSection>
            {signature === undefined ? null : (
              <ListSection>
                <ToggleRow
                  label={FEEDBACK_WORDS.SIGN}
                  detail={signatureLine(signature, signed)}
                  on={signed}
                  onChange={setSigned}
                />
              </ListSection>
            )}
          </SettingsForm>
        </ScopePicker>
      </Screen>
    </>
  );
}
