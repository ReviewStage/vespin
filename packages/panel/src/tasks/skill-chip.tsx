import { pictureMarker, pictureMarkers } from "@repo/features/picture-marker";
import type { MarkdownComponents, MarkdownNodeProps } from "@repo/ui/markdown";
import {
  holdsSlashWord,
  type SkillOption,
  skillTokens,
  skillWord,
  type TextRange,
} from "@repo/ui/skill-mention";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { afterPaint } from "../after-paint.js";
import { WordPicturesContext } from "./picture-chips.js";
import type { SkillSource } from "./skill-picker.js";
import { opensFile, SkillRef, type SkillSubject, type SkillWithFile } from "./skill-ref.js";
import { type TranscriptElement, TranscriptWords } from "./transcript-blocks.js";

/**
 * skill-chip.tsx -- a skill named in a sent message, drawn as the composer draws a chosen one, which opens the skill's `SKILL.md` in a File tab.
 *
 * A message the developer sent a coding agent names a skill as the words
 * `/name` (`skill-mention.ts`), and its bubble draws each `/name` that names
 * one of the task's repository's skills as the chip the composer drew it as
 * while it was typed (`skill-ref.tsx`), where Claude Code and Codex draw a
 * slash command as a token too; a `/word` that names none stays words. The
 * chip is a button: a press, or Enter once it has the focus, opens the
 * skill's `SKILL.md` in a File tab of the side panel, at the default branch
 * as the repository's skills were read, and it hangs the skill's card. An
 * installed skill names no file of the repository's, so its chip is no
 * button that opens nothing: it hangs its card alone, and still takes the
 * focus for it.
 * A chip the composer drew opens the same file on a press
 * (`skill-picker.tsx`). The words stay the message's own underneath, so a
 * copy of the message and a find in the tab read `/name`.
 * The skills are the ones the composer offers, read once for the task
 * (`repository-skills.ts`), and only once a transcript holds a word they
 * could name, so a conversation naming none reads nothing. The "Loaded
 * skill" row of a call that loaded one hangs the same card and opens the
 * same file (`useSkill`).
 */

/** The task's skills as read, by name, the ask that reads them, and what opening one's file does, handed to every transcript of the task. */
interface SkillFileDoors {
  /** The skills, by name; nothing before a reader asked and the read landed, or where it did not. */
  readonly skills: ReadonlyMap<string, SkillOption> | undefined;
  readonly ask: () => void;
  readonly onOpen: (skill: SkillOption) => void;
}

/** The element a chip is written into the words as, and the one attribute it carries. */
const SKILL_ELEMENT = {
  TAG: "app-skill",
  NAME: "name",
} as const;

/** The element a picture's marker is written in as, its name its attribute. */
const PICTURE_ELEMENT = {
  TAG: "app-picture-chip",
  NAME: "name",
} as const;

/** A chip written into the words: where it stands, and the element it is written in as. */
interface WordChip {
  readonly start: number;
  readonly end: number;
  readonly element: string;
}

const SkillFileContext = createContext<SkillFileDoors | undefined>(undefined);

/** The task's skills, by name, read once a reader wants them; nothing before they land, or where they were not read. */
function useKnownSkills(wanted: boolean): ReadonlyMap<string, SkillOption> | undefined {
  const doors = useContext(SkillFileContext);
  const ask = doors?.ask;
  useEffect(() => {
    if (wanted) ask?.();
  }, [wanted, ask]);
  return doors?.skills;
}

/** A skill's chip, written in as its element, the `/name` it stands for its content. */
function skillChip(text: string, token: TextRange): WordChip {
  const name = text.slice(token.start + 1, token.end);
  return {
    ...token,
    element: `<${SKILL_ELEMENT.TAG} ${SKILL_ELEMENT.NAME}="${name}">${skillWord(name)}</${SKILL_ELEMENT.TAG}>`,
  };
}

/** A picture's chip, written in as its element, its marker its content. */
function pictureChip(start: number, end: number, name: string): WordChip {
  return {
    start,
    end,
    element: `<${PICTURE_ELEMENT.TAG} ${PICTURE_ELEMENT.NAME}="${name}">${pictureMarker(name)}</${PICTURE_ELEMENT.TAG}>`,
  };
}

/** The words with each chip written in as its element, in order. */
function withChips(text: string, chips: readonly WordChip[]): string {
  let written = "";
  let at = 0;
  for (const chip of chips) {
    written += `${text.slice(at, chip.start)}${chip.element}`;
    at = chip.end;
  }
  return written + text.slice(at);
}

/**
 * The element a chip was written in as: the chip, where it names a skill the
 * message's skills hold, and its `/name` as words otherwise, as an element
 * typed into the message by hand is.
 */
function SkillElement({ node }: MarkdownNodeProps): ReactNode {
  const doors = useContext(SkillFileContext);
  const name = String(node?.properties[SKILL_ELEMENT.NAME] ?? "");
  const skill = doors?.skills?.get(name);
  if (doors === undefined || skill === undefined) return skillWord(name);
  // Note that an installed skill names no file of the repository's, so its chip is no button, and takes the focus for its card alone.
  const onOpen = opensFile(skill) ? () => doors.onOpen(skill) : undefined;
  return <SkillRef name={name} skill={skill} onOpen={onOpen} />;
}

/** The element a picture's marker was written in as: the picture's chip, where the message holds it, and its marker as words otherwise. */
function PictureElement({ node }: MarkdownNodeProps): ReactNode {
  const pictures = useContext(WordPicturesContext);
  const name = String(node?.properties[PICTURE_ELEMENT.NAME] ?? "");
  if (pictures === undefined || !pictures.names.has(name)) return pictureMarker(name);
  return pictures.chip(name);
}

/** What the chips a message's words may hold are drawn with, and the tags and attributes each is written in as. */
const CHIP_COMPONENTS: MarkdownComponents = {
  [SKILL_ELEMENT.TAG]: SkillElement,
  [PICTURE_ELEMENT.TAG]: PictureElement,
};
const CHIP_TAGS = {
  [SKILL_ELEMENT.TAG]: [SKILL_ELEMENT.NAME],
  [PICTURE_ELEMENT.TAG]: [PICTURE_ELEMENT.NAME],
} as const;

/** Hands every transcript under it the task's skills and what opening one's file does. */
export function SkillFiles({
  source,
  onOpen,
  children,
}: {
  /** Where the task's skills are read from; nothing while the task names no repository. */
  source: SkillSource | undefined;
  onOpen: (skill: SkillWithFile) => void;
  children: ReactNode;
}): React.JSX.Element {
  // Note that the press is read through a ref, so a new one each render
  // does not draw every transcript under it again.
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const [read, setRead] = useState<
    { source: SkillSource; skills: ReadonlyMap<string, SkillOption> } | undefined
  >(undefined);
  const asked = useRef<SkillSource | undefined>(undefined);
  const skills = read !== undefined && read.source === source ? read.skills : undefined;
  // Note that the skills are read once for every reader that asks, and a
  // read that did not land is asked again by the next reader that asks.
  // Note that the read goes once the frame that asked has painted, so it never holds up the words being drawn.
  const ask = useCallback(() => {
    if (source === undefined || asked.current === source) return;
    asked.current = source;
    afterPaint(() => {
      if (asked.current !== source) return;
      source().then((answer) => {
        // A read for a task or repository left since is no answer for this one.
        if (asked.current !== source) return;
        if ("skills" in answer) {
          setRead({ source, skills: new Map(answer.skills.map((skill) => [skill.name, skill])) });
        } else {
          asked.current = undefined;
        }
      });
    });
  }, [source]);
  const doors = useMemo(
    () => ({
      skills,
      ask,
      // Note that an installed skill names no file of the repository's, so naming one opens nothing.
      onOpen: (skill: SkillOption) => (opensFile(skill) ? latest.current(skill) : undefined),
    }),
    [skills, ask],
  );
  return <SkillFileContext.Provider value={doors}>{children}</SkillFileContext.Provider>;
}

/** The named skill and what opens its `SKILL.md`; nothing where no skill of the task's is so named, or its skills are not read. */
export function useSkill(name: string | undefined): SkillSubject | undefined {
  const onOpen = useContext(SkillFileContext)?.onOpen;
  const skill = useKnownSkills(name !== undefined && name !== "")?.get(name ?? "");
  if (skill === undefined || onOpen === undefined) return undefined;
  return { skill, onOpen: () => onOpen(skill) };
}

/** What opens a skill's `SKILL.md`, for the composer's chips, which read the skills themselves; nothing outside a task's page. */
export function useSkillOpener(): ((skill: SkillOption) => void) | undefined {
  return useContext(SkillFileContext)?.onOpen;
}

/** A message the developer sent, as markdown with every line break typed kept, each skill it names and each picture of its own it names (`WordPicturesContext`) drawn as its chip; `asDocument` draws it as a document and `line` on one line, as `TranscriptWords` does. */
export function SentWords({
  text,
  asDocument = false,
  line = false,
}: {
  text: string;
  asDocument?: boolean | undefined;
  line?: boolean | undefined;
}): ReactNode {
  const skills = useKnownSkills(holdsSlashWord(text));
  const pictures = useContext(WordPicturesContext);
  const chips = [
    ...(skills === undefined ? [] : skillTokens(text, new Set(skills.keys()))).map((token) =>
      skillChip(text, token),
    ),
    ...pictureMarkers(text)
      .filter((marker) => pictures?.names.has(marker.name) === true)
      .map((marker) => pictureChip(marker.start, marker.end, marker.name)),
  ].sort((first, second) => first.start - second.start);
  if (chips.length === 0) {
    return <TranscriptWords text={text} typed asDocument={asDocument} line={line} />;
  }
  const element: TranscriptElement = {
    markdown: withChips(text, chips),
    tags: CHIP_TAGS,
    components: CHIP_COMPONENTS,
  };
  return (
    <TranscriptWords text={text} element={element} typed asDocument={asDocument} line={line} />
  );
}
