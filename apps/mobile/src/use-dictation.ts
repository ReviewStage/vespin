/**
 * use-dictation.ts -- a composer's dictation: the microphone recorded on the phone, heard as words by our service, and the words put after what the field holds.
 *
 * The desktop's dictation (`@repo/panel`'s `use-dictation.ts`) on the phone,
 * through the same act (`DICTATION_TRANSCRIBE`): Dictate asks iOS for the
 * microphone where it has not been asked, and records it as AAC in an
 * MPEG-4 file (`expo-audio`), mono at the wire's bitrate, which the service
 * takes beside the desktop's WebM (`DICTATION_AUDIO.MP4`). ✓ stops the
 * recording and hands the clip to the service in one act, which has OpenAI
 * hear it on the account's own key and answers the words; the phone never
 * reaches OpenAI. The words go after what the field holds, a space between,
 * and the clip's file is deleted. ✕ drops the recording unsent, as leaving
 * the screen does. The recording stops itself a second short of the wire's
 * two minutes, so the clip lands inside the bound. Whatever fails says why
 * in the composer's note, in the desktop's words, and keeps nothing.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { DICTATION_AUDIO, DICTATION_BOUNDS } from "@repo/features/dictation-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUZZ,
  buzz,
  type ComposerDictation,
  DICTATION_PHASE,
  type DictationPhase,
} from "@repo/ui-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHostActs } from "./host/host-provider.js";

/** Why a dictation left nothing, in the desktop's words, the microphone's said where iOS keeps its switch. */
const DICTATION_NOTE = {
  MICROPHONE_DENIED: `${PRODUCT_NAME} cannot use the microphone. Allow it in Settings › ${PRODUCT_NAME} › Microphone.`,
  MICROPHONE_FAILED: "The microphone could not be opened.",
  NO_WORDS: "No words were heard.",
  FAILED: "The recording could not be transcribed. Try again.",
  /** As the panel says it (`@repo/ui`'s `OPENAI_KEY_MISSING_NOTE`), the key added in Settings › Agents › API keys. */
  OPENAI_KEY_MISSING: "Add an OpenAI key in Settings",
} as const;

/** The sample rate a clip is recorded at: speech-clear, and the rate the transcription model hears at. */
const SAMPLE_RATE = 16_000;

/** How a clip is recorded: AAC in an MPEG-4 file, mono at the wire's bitrate, so two minutes stand well inside its byte bound. */
const RECORDING = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: DICTATION_BOUNDS.AUDIO_BITS_PER_SECOND,
} as const;

/** The length a recording stops itself at: a second short of the bound, so the clip lands inside it. */
const AUTO_STOP_MS = DICTATION_BOUNDS.MAX_DURATION_MS - 1_000;

/** Says on the console what went wrong with a dictation, whose words the note says. */
function logged(what: string): (cause: unknown) => void {
  return (cause) => console.error(`${what}.`, cause);
}

/** Deletes a clip's file, which holds the developer's voice, once its words are read or it is dropped. */
function dropClip(uri: string | null): void {
  if (uri === null) return;

  try {
    new File(uri).delete();
  } catch (cause) {
    logged("A dictated clip could not be deleted")(cause);
  }
}

/** Lets the microphone go for the app's other audio, as a recording ends. */
function releaseMicrophone(): void {
  setAudioModeAsync({ allowsRecording: false }).catch(logged("The microphone was not let go"));
}

/** What `useDictation` hands the screen: the composer's dictation, and the note a failed one left, cleared as the next starts. */
export interface Dictation {
  readonly dictation: ComposerDictation;
  readonly note: string | undefined;
}

/**
 * A composer's dictation, as the module says: `words` is what the field holds
 * now, and `onWords` takes the field's words with what was heard after them.
 */
export function useDictation(words: string, onWords: (words: string) => void): Dictation {
  const acts = useHostActs();
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhase] = useState<DictationPhase>(DICTATION_PHASE.IDLE);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  // The field's words as they stand now, which the heard words go after however long the clip took.
  const held = useRef(words);
  useEffect(() => {
    held.current = words;
  }, [words]);
  // The recording's own count, so a stop on its deadline after a ✕ or a ✓ does nothing.
  const recording = useRef(0);
  const standing = useRef(true);
  // Whether a dictation is under way, from the press that starts it to its words landing or its end, so a second press while the microphone is asked for or opened starts none.
  const busy = useRef(false);

  // Note that leaving the screen drops a recording under way unsent, as the desktop drops one whose box unmounts.
  useEffect(
    () => () => {
      standing.current = false;
      recording.current += 1;

      if (recorder.isRecording) {
        recorder
          .stop()
          .then(() => dropClip(recorder.uri))
          .catch(logged("A recording was not stopped"));
        releaseMicrophone();
      }
    },
    [recorder],
  );

  // Note that leaving the page for another pushed over it drops a recording under way unsent too, as the page then stands out of sight with no ✕ or ✓ to press.
  const cancelRef = useRef<() => void>(() => undefined);
  // The page's losses of focus, so a start still waiting on the microphone sees that the page went out of sight meanwhile and records nothing.
  const unfocused = useRef(0);
  useFocusEffect(
    useCallback(
      () => () => {
        unfocused.current += 1;

        if (recorder.isRecording) cancelRef.current();
      },
      [recorder],
    ),
  );

  const fail = (said: string) => {
    busy.current = false;

    if (!standing.current) return;
    buzz(BUZZ.ERROR);
    setNote(said);
    setPhase(DICTATION_PHASE.IDLE);
    setStartedAt(undefined);
  };

  const finish = async (which: number, began: number) => {
    if (recording.current !== which) return;
    recording.current += 1;
    setPhase(DICTATION_PHASE.TRANSCRIBING);

    // Note that a stop the recorder refused, as one whose microphone was taken away meanwhile, ends the dictation as a clip not heard would.
    try {
      await recorder.stop();
    } catch (cause) {
      logged("A recording was not stopped")(cause);
      releaseMicrophone();
      dropClip(recorder.uri);
      fail(DICTATION_NOTE.FAILED);

      return;
    }

    releaseMicrophone();
    const uri = recorder.uri;

    try {
      if (uri === null) throw new Error("The recorder kept no file.");

      const audio = await new File(uri).base64();

      const answer = await acts[ACT_KIND.DICTATION_TRANSCRIBE]({
        audio,
        audioType: DICTATION_AUDIO.MP4,
        durationMs: Math.min(Date.now() - began, DICTATION_BOUNDS.MAX_DURATION_MS),
        keywords: [],
      });

      if ("failure" in answer) {
        fail(
          answer.failure === AGENT_CALL_FAILURE.OPENAI_KEY_MISSING
            ? DICTATION_NOTE.OPENAI_KEY_MISSING
            : DICTATION_NOTE.FAILED,
        );

        return;
      }

      const heard = answer.text.trim();

      if (heard === "") {
        fail(DICTATION_NOTE.NO_WORDS);

        return;
      }

      busy.current = false;

      if (!standing.current) return;
      const before = held.current.trimEnd();
      onWords(before === "" ? heard : `${before} ${heard}`);
      setPhase(DICTATION_PHASE.IDLE);
      setStartedAt(undefined);
      buzz(BUZZ.SUCCESS);
    } catch (cause) {
      logged("A dictated clip was not transcribed")(cause);
      fail(DICTATION_NOTE.FAILED);
    } finally {
      dropClip(uri);
    }
  };

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setNote(undefined);
    const focus = unfocused.current;
    // Whether the page went out of sight, or the screen left, while the start waited.
    const left = () => unfocused.current !== focus || !standing.current;
    const permission = await requestRecordingPermissionsAsync();

    if (left()) {
      busy.current = false;

      return;
    }

    if (!permission.granted) {
      fail(DICTATION_NOTE.MICROPHONE_DENIED);

      return;
    }

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();

      // Note that a start whose page left while the microphone opened lets it go unrecorded.
      if (left()) {
        releaseMicrophone();
        busy.current = false;

        return;
      }

      recorder.record();
    } catch (cause) {
      logged("The microphone could not be opened")(cause);
      releaseMicrophone();
      fail(DICTATION_NOTE.MICROPHONE_FAILED);

      return;
    }

    recording.current += 1;
    const which = recording.current;
    const began = Date.now();
    setStartedAt(began);
    setPhase(DICTATION_PHASE.RECORDING);
    buzz(BUZZ.SELECTION);
    // Note that the recording stops itself a second short of the bound, and is sent as ✓ would send it.
    setTimeout(() => void finish(which, began), AUTO_STOP_MS);
  };

  const cancel = () => {
    busy.current = false;
    recording.current += 1;
    setPhase(DICTATION_PHASE.IDLE);
    setStartedAt(undefined);
    recorder
      .stop()
      .then(() => dropClip(recorder.uri))
      .catch(logged("A recording was not stopped"))
      .finally(releaseMicrophone);
  };

  useEffect(() => {
    cancelRef.current = cancel;
  });

  return {
    dictation: {
      phase,
      startedAt,
      onStart: () => void start(),
      onCancel: cancel,
      onFinish: () => {
        if (startedAt !== undefined) void finish(recording.current, startedAt);
      },
    },
    note,
  };
}
