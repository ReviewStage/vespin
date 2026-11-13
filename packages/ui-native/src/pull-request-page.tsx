// pull-request-page.tsx -- a pull request's page: its heading with where it stands, who opened it and its branches, the rows of its checks and reviews, each with its face, the line a change GitHub refused leaves, and the question an act asks first.

import {
  Alert,
  Host,
  HStack,
  Menu,
  Button as SwiftUIButton,
  Text,
  TextField,
  Toggle,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  menuIndicator,
  monospacedDigit,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { GitHubPerson, PullRequestState } from "@repo/features/agent-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { agoText } from "@repo/features/time-format";
import { type ReactElement, useEffect, useState } from "react";
import { useScaledSize } from "./accessibility.js";
import { FieldChip } from "./button.js";
import { GLYPH, type MarkLook } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { RowFrame, RowHead } from "./list-row.js";
import { Avatar, FACE_KIND, type Face, ToneGlyph } from "./marks.js";
import { STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What joins a pull request's branches, the one it merges from after the one it merges into, as GitHub writes it. */
const BRANCH_ARROW = "←";

/** Someone a pull request names on GitHub, as a face: their login, their avatar, and an App's bot in its rounded square, as the panel draws them. */
export function githubFace(person: GitHubPerson): Face {
  return {
    name: person.login,
    picture: person.avatarUrl,
    kind: person.bot ? FACE_KIND.APP : FACE_KIND.PERSON,
  };
}

/** Who opened a pull request and when, and when it merged where it has. */
type Opened = {
  /** Who opened it, by their GitHub name and avatar; none where the read names no one. */
  readonly by: Face | undefined;
  readonly at: number;
  readonly mergedAt: number | null;
};

type PullRequestHeadProps = {
  readonly title: string;
  readonly number: number;
  readonly state: PullRequestState;
  /** Whether GitHub's merge queue holds it, which its mark says in the merge's glyph. */
  readonly queued: boolean;
  /** Where it stands in a word, as the panel's pill says it: "Open", "Queued #2", "Merged". */
  readonly stateLabel: string;
  /** The branch it merges into and the one it merges from; none until its read lands. */
  readonly branches?: { readonly base: string; readonly head: string } | undefined;
  /** Whether it would merge as it stands, in GitHub's sentence: "Ready to merge". */
  readonly sentence?: string | undefined;
  /** Who opened it and when; none until its read lands. */
  readonly opened?: Opened | undefined;
};

/** One branch, as the panel's header names it: Lucide's branch glyph, then its name in the monospaced face. */
function Branch({ name }: { readonly name: string }) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT}>
      <ToneGlyph
        glyph={GLYPH.BRANCH}
        tone={STATUS_TONE.NEUTRAL}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(1),
        ]}
      >
        {name}
      </Text>
    </HStack>
  );
}

/**
 * Who opened a pull request and when, as the panel's header says it in one
 * phrase: their face and name, then "opened 3h ago", or, once it merged,
 * "opened · merged 1h ago", the moment that matters once it has; without
 * anyone to name, the phrase alone.
 */
function OpenedLine({ opened }: { readonly opened: Opened }) {
  const colors = useColors();
  const face = useScaledSize(MARK_SIZE.FACE);
  const verb = opened.by === undefined ? "Opened" : "opened";
  const now = Date.now();

  const when =
    opened.mergedAt === null
      ? `${verb} ${agoText(opened.at, now)}`
      : `${verb} · merged ${agoText(opened.mergedAt, now)}`;

  return (
    <HStack spacing={SPACE.TIGHT + 2}>
      {opened.by === undefined ? null : (
        <Avatar
          name={opened.by.name}
          picture={opened.by.picture}
          kind={opened.by.kind}
          size={face}
        />
      )}
      <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), lineLimit(1)]}>
        {opened.by === undefined ? null : (
          <Text modifiers={[foregroundStyle(colors.TEXT_BODY)]}>{`${opened.by.name} `}</Text>
        )}
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{when}</Text>
      </Text>
    </HStack>
  );
}

/**
 * A pull request's heading, as a list's first row: its title in 20 pt
 * semibold with its number muted after it, then where it stands as a chip,
 * its state's glyph in GitHub's color and its word, then who opened it and
 * when, by their face, then its branches on a line of their own, the one it
 * merges into first, then GitHub's sentence of whether it would merge, in
 * the body's ink.
 */
export function PullRequestHead({
  title,
  number,
  state,
  queued,
  stateLabel,
  branches,
  sentence,
  opened,
}: PullRequestHeadProps) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[pullRequestMarkState({ state, queued })];

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({ leading: SPACE.EDGE, trailing: SPACE.EDGE, top: SPACE.TIGHT, bottom: 0 }),
      ]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        <Text>{title}</Text>
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED), monospacedDigit()]}>
          {` #${number}`}
        </Text>
      </Text>
      <HStack spacing={SPACE.TIGHT + 2}>
        <FieldChip label={stateLabel} mark={{ glyph: look.symbol, tone: look.tone }} />
      </HStack>
      {opened === undefined ? null : <OpenedLine opened={opened} />}
      {branches === undefined ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <Branch name={branches.base} />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {BRANCH_ARROW}
          </Text>
          <Branch name={branches.head} />
        </HStack>
      )}
      {sentence === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {sentence}
        </Text>
      )}
    </VStack>
  );
}

/** Where a row's face stands: in the lead column in its mark's place, as a reviewer's does, or beside the mark before the title, as the App that runs a check does. */
export const MARK_FACE = {
  LEAD: "lead",
  BESIDE: "beside",
} as const;

export type MarkFace = (typeof MARK_FACE)[keyof typeof MARK_FACE];

type MarkRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** Its mark: where the thing it names stands, in that tone. */
  readonly mark: MarkLook;
  readonly title: string;
  /** What ends its line, muted: where it stands in words, or how long it ran. */
  readonly detail?: string | undefined;
  /** Whose row it is, by their face, where the panel draws one: a reviewer, or the App that runs a check. */
  readonly face?: { readonly of: Face; readonly stands: MarkFace } | undefined;
};

/**
 * A row of a pull request's page, such as a check or a reviewer: its mark
 * in the lead column, its name in 15 pt, and what ends its line, 12 pt and
 * muted, standing as every list row does, plain and edge to edge with a
 * hairline under the words. A reviewer's face takes the lead column, its
 * mark moving to the line's end before its words, as the panel's facepile
 * wears where each stands; a check's App stands by its avatar beside the
 * mark. The row is heard as one element, its name and then its words.
 */
export function MarkRow({ id, mark, title, detail, face }: MarkRowProps) {
  const colors = useColors();
  const faceSize = useScaledSize(MARK_SIZE.FACE);
  const glyph = <ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.ROW_TITLE} />;
  const leads = face?.stands === MARK_FACE.LEAD;

  const avatar =
    face === undefined ? null : (
      <Avatar name={face.of.name} picture={face.of.picture} kind={face.of.kind} size={faceSize} />
    );

  const words =
    detail === undefined ? null : (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {detail}
      </Text>
    );

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={leads ? avatar : glyph}
      beside={leads ? undefined : avatar}
      title={title}
      ink={colors.TEXT_BODY}
      end={
        leads ? (
          <HStack spacing={SPACE.TIGHT}>
            {glyph}
            {words}
          </HStack>
        ) : (
          words
        )
      }
    />
  );

  return <RowFrame id={id} row={row} heard={{ label: title, value: [detail] }} />;
}

/**
 * What a change GitHub did not make leaves to say, as a list's row: our
 * sentence by a warning in the danger ink, and GitHub's own words quoted
 * under it where it said some.
 */
export function WriteNoteRow({
  words,
  said,
}: {
  readonly words: string;
  readonly said?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowInsets({
          leading: SPACE.EDGE,
          trailing: SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: SPACE.TIGHT,
        }),
      ]}
    >
      <ToneGlyph
        glyph={GLYPH.FAILED}
        tone={STATUS_TONE.DANGER}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT)]}>
          {words}
        </Text>
        {said === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {said}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** A way to merge the merge's menu offers, such as Squash and merge, checked where it is the one a tap uses. */
export interface MergeMethodChoice {
  readonly label: string;
  readonly on: boolean;
  readonly onPress: () => void;
}

/**
 * The merge's one press as a row of the page, where a regular window's bar
 * folds its acts out of sight, as GitHub's own app stands Merge under a
 * pull request's checks: the system's large button, as wide as its words,
 * filled in the accent with its words in the brand's ink where it is the
 * page's one act, such as Squash and merge, and outlined in it otherwise,
 * such as Remove from queue. Where the repository merges more than one way
 * it is a split button, as the panel's merge box is: a tap merges the way
 * chosen, and a long press or its chevron opens the ways, the chosen one
 * checked. It is dimmed while a change is out, its words then saying what
 * is under way.
 */
export function MergeActRow({
  label,
  prominent,
  disabled: dimmed,
  methods = [],
  onPress,
}: {
  readonly label: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  /** The ways to merge, offered behind the chevron where there is more than one. */
  readonly methods?: readonly MergeMethodChoice[];
  readonly onPress: () => void;
}) {
  const colors = useColors();

  const words = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
        foregroundStyle(prominent ? colors.ON_ACCENT : colors.TEXT),
      ]}
    >
      {label}
    </Text>
  );

  const look = [
    buttonStyle(prominent ? "borderedProminent" : "bordered"),
    controlSize("large"),
    tint(prominent ? colors.ACCENT : colors.TEXT),
    disabled(dimmed),
    listRowBackground("clear"),
    listRowSeparator("hidden"),
    listRowInsets({
      leading: SPACE.EDGE,
      trailing: SPACE.EDGE,
      top: SPACE.TIGHT,
      bottom: SPACE.TIGHT,
    }),
  ];

  // Note that a single way to merge leaves nothing to choose, so the press stands as a plain button with no chevron.
  if (methods.length < 2) {
    return (
      <SwiftUIButton onPress={onPress} modifiers={look}>
        {words}
      </SwiftUIButton>
    );
  }

  return (
    <Menu label={words} onPrimaryAction={onPress} modifiers={[...look, menuIndicator("visible")]}>
      {methods.map((method) => (
        <Toggle
          key={method.label}
          label={method.label}
          isOn={method.on}
          onIsOnChange={() => method.onPress()}
        />
      ))}
    </Menu>
  );
}

type ConfirmAskProps = {
  /** The question, as the panel's confirm asks it: "Remove from the merge queue?" */
  readonly title: string;
  /** What the act costs, under the question. */
  readonly message?: string | undefined;
  /** The act's own words, the alert's act beside Cancel. */
  readonly act: string;
  /** Whether the act ends or takes away something, which the system draws red. */
  readonly destructive?: boolean | undefined;
  /**
   * Words the person types before the act can be pressed, such as the
   * account's address before Delete account, as the panel's confirm gates
   * an act that cannot be undone.
   */
  readonly gate?: string | undefined;
  readonly presented: boolean;
  readonly onAct: () => void;
  /** Called as the alert goes, by its act or Cancel. */
  readonly onDismiss: () => void;
};

/** What an act that asks first offers beside its act, and the role the system draws it in. */
const CANCEL = { LABEL: "Cancel", ROLE: "cancel" } as const;

/**
 * The question an act asks first, as the system's alert: its question,
 * what it costs, Cancel, and its act last, as the panel's confirm stands.
 * Note that it is an alert rather than a confirmation dialog, because iOS
 * 26 draws a confirmation dialog as a popover on the view that presents it,
 * and the act is pressed in the bar or on a card, which this cannot stand
 * on; an alert stands centered whatever presents it. It stands in a host
 * of its own, the size of nothing, so a screen draws it beside whatever it
 * shows and presents it from a press anywhere: beside its `Screen`, never
 * inside that host, where a screen drawing it took no press and no key at
 * all on the simulators (the Tasks list and Search did). A gated ask holds the
 * system's field in the alert, its act dimmed until the field holds the
 * gate's words exactly.
 */
export function ConfirmAsk({
  title,
  message,
  act,
  destructive = false,
  gate,
  presented,
  onAct,
  onDismiss,
}: ConfirmAskProps) {
  const typed = useNativeState("");
  const [words, setWords] = useState("");
  // Note that the field is emptied each time the alert opens, so every ask is typed afresh and none is let through by an earlier one's words.
  useEffect(() => {
    if (!presented) return;
    typed.value = "";
    setWords("");
  }, [presented, typed]);
  const shut = gate !== undefined && words !== gate;

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <Alert
        title={title}
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Alert.Trigger>
          <Text modifiers={[frame({ width: 0, height: 0 })]}>{""}</Text>
        </Alert.Trigger>
        <Alert.Actions>
          {gate === undefined ? null : (
            <TextField
              text={typed}
              placeholder={gate}
              onTextChange={setWords}
              modifiers={[autocorrectionDisabled(), textInputAutocapitalization("never")]}
            />
          )}
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
          <SwiftUIButton
            label={act}
            role={destructive ? "destructive" : "default"}
            onPress={onAct}
            modifiers={[disabled(shut)]}
          />
        </Alert.Actions>
        {message === undefined ? null : (
          <Alert.Message>
            <Text>{message}</Text>
          </Alert.Message>
        )}
      </Alert>
    </Host>
  );
}

/** What a `WordsAsk` field takes, and the keyboard it raises for it. */
export const WORDS_ASK_KIND = {
  /** A name, capitalized and corrected as the system does. */
  NAME: "name",
  /** An email address, on the address keyboard, with nothing capitalized or corrected. */
  EMAIL: "email",
} as const;

export type WordsAskKind = (typeof WORDS_ASK_KIND)[keyof typeof WORDS_ASK_KIND];

/** One of a `WordsAsk`'s acts beside Cancel, handed the words typed. */
export interface WordsAskAct {
  readonly label: string;
  readonly onAct: (words: string) => void;
}

type WordsAskProps = {
  readonly title: string;
  readonly message?: string | undefined;
  readonly placeholder: string;
  /** The words the field holds as the alert opens, such as the name a rename starts from. */
  readonly initial?: string | undefined;
  readonly kind: WordsAskKind;
  /** Its acts, the last the one Return presses; each dimmed while the field is empty. */
  readonly acts: readonly WordsAskAct[];
  readonly presented: boolean;
  /** Called as the alert goes, by an act or Cancel. */
  readonly onDismiss: () => void;
};

/**
 * Words asked for in the system's alert, as iOS asks a rename or an
 * address: its field, Cancel, and its acts, each dimmed until something is
 * typed. The field starts from `initial` each time the alert opens. It
 * stands in a host of its own, the size of nothing, as `ConfirmAsk` does.
 */
export function WordsAsk({
  title,
  message,
  placeholder,
  initial = "",
  kind,
  acts,
  presented,
  onDismiss,
}: WordsAskProps) {
  const typed = useNativeState(initial);
  const [words, setWords] = useState(initial);
  useEffect(() => {
    if (!presented) return;
    typed.value = initial;
    setWords(initial);
  }, [presented, initial, typed]);
  const empty = words.trim().length === 0;

  const field =
    kind === WORDS_ASK_KIND.EMAIL
      ? [
          keyboardType("email-address"),
          autocorrectionDisabled(),
          textInputAutocapitalization("never"),
        ]
      : [textInputAutocapitalization("words")];

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <Alert
        title={title}
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <Alert.Trigger>
          <Text modifiers={[frame({ width: 0, height: 0 })]}>{""}</Text>
        </Alert.Trigger>
        <Alert.Actions>
          <TextField
            text={typed}
            placeholder={placeholder}
            onTextChange={setWords}
            modifiers={field}
          />
          <SwiftUIButton label={CANCEL.LABEL} role={CANCEL.ROLE} onPress={onDismiss} />
          {acts.map((act) => (
            <SwiftUIButton
              key={act.label}
              label={act.label}
              onPress={() => act.onAct(words.trim())}
              modifiers={[disabled(empty)]}
            />
          ))}
        </Alert.Actions>
        {message === undefined ? null : (
          <Alert.Message>
            <Text>{message}</Text>
          </Alert.Message>
        )}
      </Alert>
    </Host>
  );
}
