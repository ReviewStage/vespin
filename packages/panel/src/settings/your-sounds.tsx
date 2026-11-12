import type { AccountSounds } from "@repo/features/account-preferences-live";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  SOUND_CLIP_BOUNDS,
  SOUND_CLIP_SLOT,
  type Sound,
  type SoundClipSlot,
} from "@repo/features/sound-clip-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type SettingsRowsInput,
  settingFromOption,
} from "@repo/settings";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  IconButton,
  PlusIcon,
  SettingsSection,
  STATUS_TONE,
  TEXT_FIELD_AUTO_COMPLETE,
  TextField,
  Tooltip,
  useConfirmDialog,
  useFilePicker,
} from "@repo/ui";
import { playSoundClip } from "@repo/ui/completion-sound";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH, PlayIcon, TrashIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import {
  COMPLETION_SOUND_GROUP_LABEL,
  COMPLETION_SOUND_GROUP_OF,
  type CompletionSound,
} from "@repo/wire/app-settings";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAccountPreferences } from "../account-choices.js";
import { actMutation, pressMutation } from "../act-mutations.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import {
  CLIP_ACCEPT,
  CLIP_SOUND_OF_SLOT,
  type ClipRead,
  chosenSound,
  clipLoaded,
  clipOfFile,
  soundBytes,
  soundNameOfFile,
} from "../sound-clip.js";
import { showToast } from "../toast.js";
import { MenuRow } from "./menu-row.js";
import { useSettingRowWrite } from "./row-write.js";
import type { ChoiceMenu } from "./schema-rows.js";

/**
 * your-sounds.tsx -- the sounds the account keeps of its own, in Settings' Notifications: listed first in each sound's pop-up, added from it or from the + beside Play under a name the member gives, and listed apart to play, rename, or remove.
 *
 * Each of the account's two sounds lists its own sounds by name under
 * Yours, each with a ⋯ that renames or removes it, then Simple and Playful,
 * and pins Add a sound… at its menu's foot; the + beside Play adds one too, so adding never hides in the menu. A
 * picked file is read on this machine first (`sound-clip.ts`'s
 * `clipOfFile`) and refused under its row in a sentence naming the file;
 * a file it reads asks for the sound's name, its own name offered to
 * start from, and the sound added is chosen for that row at once. Every
 * sound stands in Your sounds under the rows, where it plays, and its ⋯
 * renames it or removes it, which asks first and puts any row that played
 * it back to its default. A sound's name is the member's own words, so it
 * is masked in session replay wherever it is drawn; only the clip and the
 * name travel, never the file's name itself.
 */

const SOUND_WORDS = {
  ADD: "Add a sound…",
  ADD_HINT: "Add a sound",
  ADDING: "Adding",
  PLAY: (name: string) => `Play ${name}`,
  READING: "Loading",
  RENAME: "Rename…",
  REMOVE: "Remove…",
  THING: "Sound",
  NAME_LABEL: "Name",
  NAME_TITLE: "Name this sound",
  RENAME_TITLE: "Rename sound",
  SAVE: "Save",
  SAVING: "Saving",
  REMOVE_TITLE: "Remove this sound?",
  REMOVE_BODY: "It is deleted, and a sound set to it goes back to its default.",
  REMOVE_VERB: "Remove sound",
  REMOVING: "Removing",
  LIST: "Your sounds",
  NOT_ADDED: "Your sound could not be added.",
  NOT_REMOVED: "Your sound could not be removed.",
  NOT_RENAMED: "Your sound could not be renamed.",
  NOT_CHOSEN: "Your sound could not be chosen.",
} as const;

/** What a sound of the account's own offers from its ⋯ in a sound's menu. */
const SOUND_ACT = {
  RENAME: "rename",
  REMOVE: "remove",
} as const;

/** Those acts as the rows its ⋯ opens. */
const SOUND_ACTS = [
  { id: SOUND_ACT.RENAME, label: SOUND_WORDS.RENAME, icon: <GLYPH.RENAME /> },
  { id: SOUND_ACT.REMOVE, label: SOUND_WORDS.REMOVE, icon: <TrashIcon /> },
] as const;

/** Says that the service refused an act on one of the account's own sounds, in the app's own words, never the sound's name. */
function toastRefused(words: string, answer: unknown): void {
  showToast({
    words,
    replayUnmasked: true,
    tone: STATUS_TONE.DANGER,
    failure: { surface: FAILURE_SURFACE.SOUND_CLIP_WRITE, cause: answer },
  });
}

/** The setting each of the account's two sounds is stored as. */
const FIELD_OF_SLOT = {
  [SOUND_CLIP_SLOT.FINISH]: APP_SETTING_SCHEMA.completionSound.field,
  [SOUND_CLIP_SLOT.ASK]: APP_SETTING_SCHEMA.askSound.field,
} as const satisfies Record<SoundClipSlot, AppSettingField>;

/** The slot whose setting `field` is; none for any other setting. */
function slotOf(field: AppSettingField): SoundClipSlot | undefined {
  if (field === FIELD_OF_SLOT[SOUND_CLIP_SLOT.FINISH]) return SOUND_CLIP_SLOT.FINISH;

  if (field === FIELD_OF_SLOT[SOUND_CLIP_SLOT.ASK]) return SOUND_CLIP_SLOT.ASK;

  return undefined;
}

/** The heading a sound is listed under in its menu: Yours, Simple, or Playful. */
function sectionOf(token: string): string | undefined {
  // SAFETY: a token that names no sound reads undefined, which the line below answers.
  const group = COMPLETION_SOUND_GROUP_OF[token as CompletionSound];

  return group === undefined ? undefined : COMPLETION_SOUND_GROUP_LABEL[group];
}

/** What the name dialog names: a file just read, to add for a sound, or a sound to rename. */
type Naming =
  | { readonly slot: SoundClipSlot; readonly read: Extract<ClipRead, { clip: string }> }
  | { readonly sound: Sound };

/** What a sound of the account's own is renamed and removed by, from its ⋯ in a sound's menu or in the list. */
interface SoundManage {
  readonly rename: (sound: Sound) => void;
  readonly remove: (sound: Sound) => void;
}

/** One of the account's two sounds: its choice of a sound of its own, its menu's additions, and its +. */
interface Slot {
  readonly menu: ChoiceMenu;
  readonly upload: React.ReactNode;
  /** Writes the setting back to its default where it played the sound removed. */
  readonly forget: (id: string) => void;
  /** Stores the setting as the account's own and chooses `id` for it. */
  readonly choose: (id: string) => void;
}

function useSlot(
  slot: SoundClipSlot,
  view: SettingsRowsInput,
  sounds: AccountSounds | undefined,
  add: (slot: SoundClipSlot) => void,
  manage: SoundManage,
  refusal: string | undefined,
): Slot {
  const field = FIELD_OF_SLOT[slot];
  const token = CLIP_SOUND_OF_SLOT[slot];

  // Note that a pick of one of the account's own sounds writes here rather than through the row's write, so a refusal toasts, as no tick or line under the row says it.
  const write = useSettingRowWrite(
    field,
    (value: string) => settingFromOption(field, value, view),
    undefined,
    true,
  );

  const { mutate: sendChoice } = useMutation(pressMutation(ACT_KIND.SOUND_CHOOSE));
  const stored = view.settings[field] === token;
  const chosen = chosenSound(sounds, slot)?.id;

  // Note that the row is stored as the account's own only once the service
  // took this very choice, so a refused one, or one that answers another
  // sound because this one was removed meanwhile, leaves the sound it played.
  const choose = (id: string) => {
    sendChoice(
      { slot, id },
      {
        onSuccess: (answer) => {
          if ("failure" in answer || answer.id !== id) toastRefused(SOUND_WORDS.NOT_CHOSEN, answer);
          else if (!stored) write.run(token);
        },
      },
    );
  };

  return {
    menu: {
      section: sectionOf,
      own: {
        token,
        // Note that each sound's ⋯ renames or removes it in place, beside its name, before the check of the one playing.
        options: (sounds?.list ?? []).map((sound) => ({
          value: sound.id,
          label: sound.name,
          actions: {
            thing: SOUND_WORDS.THING,
            rows: SOUND_ACTS,
            onPick: (act: string) => {
              if (act === SOUND_ACT.RENAME) return manage.rename(sound);

              if (act === SOUND_ACT.REMOVE) return manage.remove(sound);
              throw new Error(`Unknown sound act: ${act}`);
            },
          },
        })),
        chosen,
        pick: choose,
      },
      foot: [{ id: "add", label: SOUND_WORDS.ADD, icon: <PlusIcon />, onPress: () => add(slot) }],
      // Note that a refusal names the picked file; the row masks its error for session replay.
      error: refusedShown(refusal, FAILURE_SURFACE.SOUND_CLIP_WRITE),
    },
    upload: (
      <Tooltip label={SOUND_WORDS.ADD_HINT}>
        <IconButton icon={<PlusIcon />} label={SOUND_WORDS.ADD_HINT} onClick={() => add(slot)} />
      </Tooltip>
    ),
    forget: (id) => {
      if (stored && chosen === id) write.run(APP_SETTING_DEFAULTS[field]);
    },
    choose,
  };
}

/** The dialog that names a sound as it is added, or renames one. */
function useNameDialog(
  onAdded: (slot: SoundClipSlot, sound: Sound, bytes: Uint8Array) => void,
  onRefused: (slot: SoundClipSlot) => void,
) {
  const [naming, setNaming] = useState<Naming>();
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const { mutate: sendAdd } = useMutation(pressMutation(ACT_KIND.SOUND_ADD));
  const { mutate: sendRename } = useMutation(pressMutation(ACT_KIND.SOUND_RENAME));
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= SOUND_CLIP_BOUNDS.MAX_NAME_CHARS;

  const confirm = useConfirmDialog(
    { subject: naming !== undefined, surfaceOpen: true },
    neverBusyAct(() => {
      if (naming === undefined) return;

      if ("sound" in naming) {
        sendRename(
          { id: naming.sound.id, name: trimmed },
          {
            onSuccess: (answer) => {
              if ("failure" in answer) toastRefused(SOUND_WORDS.NOT_RENAMED, answer);
            },
          },
        );

        return;
      }

      const { slot, read } = naming;
      sendAdd(
        { name: trimmed, clip: read.clip, slot },
        {
          onSuccess: (answer) => {
            if ("sound" in answer) onAdded(slot, answer.sound, read.bytes);
            else onRefused(slot);
          },
        },
      );
    }),
    confirmFailure(FAILURE_SURFACE.SOUND_CLIP_WRITE),
  );

  const form = useFormDialog(confirm, valid);

  const dialog =
    naming === undefined ? null : (
      <Dialog
        open={form.open}
        title={"sound" in naming ? SOUND_WORDS.RENAME_TITLE : SOUND_WORDS.NAME_TITLE}
        replayUnmasked
        busy={form.settling}
        initialFocus={field}
        onDismiss={form.dismiss}
        actions={
          <DialogActions
            onCancel={form.dismiss}
            act={{
              verb: SOUND_WORDS.SAVE,
              tone: DIALOG_TONE.PRIMARY,
              running: SOUND_WORDS.SAVING,
              ...form.act,
            }}
          />
        }
      >
        {/* Note that the title already asks for the name, so the field is named for a reader alone and stands under it. */}
        <ReplayMask>
          <TextField
            ref={field}
            label={SOUND_WORDS.NAME_LABEL}
            autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
            maxLength={SOUND_CLIP_BOUNDS.MAX_NAME_CHARS}
            value={name}
            disabled={form.settling}
            onEnter={form.submit}
            onChange={setName}
          />
        </ReplayMask>
      </Dialog>
    );

  return {
    ask: (next: Naming, start: string) => {
      setNaming(next);
      setName(start);
      confirm.ask();
    },
    dialog,
  };
}

/** Play leading one of the account's own sounds' rows: its clip read through the host, then played, the press busy while it is read. */
function PlaySound({ sound }: { sound: Sound }): React.JSX.Element {
  const [reading, setReading] = useState(false);
  const label = SOUND_WORDS.PLAY(sound.name);

  return (
    <Tooltip label={label}>
      <IconButton
        icon={<PlayIcon />}
        label={label}
        busy={reading}
        busyLabel={SOUND_WORDS.READING}
        onClick={() => {
          setReading(true);
          soundBytes(sound.id)
            .then((read) => (read === undefined ? undefined : playSoundClip(read.bytes)))
            .catch(() => undefined)
            .finally(() => setReading(false));
        }}
      />
    </Tooltip>
  );
}

/** Your sounds: each of the account's own sounds, led by its Play, whose ⋯ renames or removes it. */
function SoundList({
  sounds,
  onRename,
  onRemove,
}: {
  sounds: readonly Sound[];
  onRename: (sound: Sound) => void;
  onRemove: (sound: Sound) => void;
}): React.JSX.Element {
  return (
    <SettingsSection title={SOUND_WORDS.LIST}>
      {sounds.map((sound) => (
        <MenuRow
          key={sound.id}
          thing={sound.name}
          actions={[
            { label: SOUND_WORDS.RENAME, icon: <GLYPH.RENAME />, onSelect: () => onRename(sound) },
            {
              label: SOUND_WORDS.REMOVE,
              icon: <TrashIcon />,
              danger: true,
              onSelect: () => onRemove(sound),
            },
          ]}
          row={{
            leading: <PlaySound sound={sound} />,
            label: <ReplayMask>{sound.name}</ReplayMask>,
          }}
        />
      ))}
    </SettingsSection>
  );
}

/** The account's own sounds as the Notifications section draws them, by the setting each of its two sounds is stored as. */
export interface YourSounds {
  readonly menus: (field: AppSettingField) => ChoiceMenu | undefined;
  readonly upload: (field: AppSettingField) => React.ReactNode;
  /** Your sounds, under the section, while the account keeps any. */
  readonly list: React.ReactNode;
  /** What stands apart from any row: the file picker and the dialogs. */
  readonly drawn: React.ReactNode;
}

export function useYourSounds(view: SettingsRowsInput): YourSounds {
  const sounds = useAccountPreferences().data?.sounds;
  const [refusals, setRefusals] = useState<Partial<Record<SoundClipSlot, string>>>({});
  const target = useRef<SoundClipSlot>(SOUND_CLIP_SLOT.FINISH);

  const refuse = (slot: SoundClipSlot, words: string | undefined) =>
    setRefusals((was) => ({ ...was, [slot]: words }));

  const naming = useNameDialog(
    (slot, sound, bytes) => {
      clipLoaded(slot, sound.sha256, bytes).catch(() => undefined);
      slots[slot].choose(sound.id);
    },
    (slot) => refuse(slot, SOUND_WORDS.NOT_ADDED),
  );

  const picker = useFilePicker({
    accept: CLIP_ACCEPT,
    onFiles: ([picked]) => {
      if (picked === undefined) return;
      const slot = target.current;
      clipOfFile(picked).then(
        (read) => {
          if ("refusal" in read) refuse(slot, read.refusal);
          else naming.ask({ slot, read }, soundNameOfFile(picked));
        },
        () => refuse(slot, SOUND_WORDS.NOT_ADDED),
      );
    },
  });

  const add = (slot: SoundClipSlot) => {
    target.current = slot;
    refuse(slot, undefined);
    picker.open();
  };

  // Note that these are hoisted, since the remove's confirm is held below the rows that offer it.
  const manage: SoundManage = { rename: askRename, remove: askRemove };

  function askRename(sound: Sound) {
    naming.ask({ sound }, sound.name);
  }

  function askRemove(sound: Sound) {
    setRemoving(sound);
    remove.ask();
  }

  const finish = useSlot(
    SOUND_CLIP_SLOT.FINISH,
    view,
    sounds,
    add,
    manage,
    refusals[SOUND_CLIP_SLOT.FINISH],
  );

  const ask = useSlot(
    SOUND_CLIP_SLOT.ASK,
    view,
    sounds,
    add,
    manage,
    refusals[SOUND_CLIP_SLOT.ASK],
  );

  const slots = { [SOUND_CLIP_SLOT.FINISH]: finish, [SOUND_CLIP_SLOT.ASK]: ask } as const;

  const [removing, setRemoving] = useState<Sound>();
  const removal = useMutation(actMutation(ACT_KIND.SOUND_REMOVE));

  const removeAct = useConfirmAct(removal, {
    send: () => {
      const sound = removing;

      if (sound === undefined) return Promise.resolve();

      return removal.mutateAsync({ id: sound.id }).then((answer) => {
        if ("failure" in answer) return;
        finish.forget(sound.id);
        ask.forget(sound.id);
      });
    },
    answered: (answer) =>
      "failure" in answer
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: SOUND_WORDS.NOT_REMOVED }
        : ANSWER_ACCEPTED,
    failed: refusedWith,
  });

  const remove = useConfirmDialog(
    { subject: removing !== undefined, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.SOUND_CLIP_WRITE),
  );

  const list = sounds?.list ?? [];

  return {
    menus: (field) => {
      const slot = slotOf(field);

      return slot === undefined ? undefined : slots[slot].menu;
    },
    upload: (field) => {
      const slot = slotOf(field);

      return slot === undefined ? undefined : slots[slot].upload;
    },
    list:
      list.length === 0 ? null : (
        <SoundList sounds={list} onRename={askRename} onRemove={askRemove} />
      ),
    drawn: (
      <>
        {picker.input}
        {naming.dialog}
        <ConfirmDialog
          open
          confirm={remove}
          question={{
            title: SOUND_WORDS.REMOVE_TITLE,
            replayUnmasked: true,
            body: SOUND_WORDS.REMOVE_BODY,
            verb: SOUND_WORDS.REMOVE_VERB,
            running: SOUND_WORDS.REMOVING,
            loss: CONFIRM_LOSS.IRREVERSIBLE,
          }}
        />
      </>
    ),
  };
}
