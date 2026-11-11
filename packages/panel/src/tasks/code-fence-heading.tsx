import {
  CODE_CARD_TITLE,
  CodeCardHeader,
  type CodeCardTitle,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  SearchableMenu,
} from "@repo/ui";
import { SUGGESTED_CHANGE_LANGUAGE } from "@repo/ui/github-html";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { type ReactNode, useId, useRef, useState } from "react";
import {
  CODE_LANGUAGE_CHOICES,
  codeLanguage,
  codeLanguageChoice,
  codeTitle,
} from "../code-language.js";
import { copyThroughShell } from "../copy-feedback.js";
import type { EditorCodeBlock } from "../description-editor/contract.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * code-fence-heading.tsx -- how a fenced block is headed, by its language, wherever the window draws one: a drawn text's code card, and a block open in a text's editor, whose language is chosen from its header.
 *
 * A block is headed by its language's file icon and the name a reader says
 * it by ("TypeScript"), its id in mono where this window has no name for
 * it, and "text" for a fence that names none (`../code-language.ts`); a
 * change suggested to a review comment's lines is headed as GitHub heads
 * one, "Suggested change". The
 * drawn text's card (`transcript-markdown.tsx`) and the editor's block
 * (`EditorCodeHeader`) are headed by this one reading, through `@repo/ui`'s
 * one code card header, so a block reads the same edited as drawn, and a
 * text opened to be edited moves no block.
 */

/** The language a suggestion is written in, and what a suggestion's block's header calls it, as GitHub heads one. */
export const SUGGESTION_LANGUAGE = "suggestion";
const SUGGESTION_LABEL = "Suggested change";

/** What the language menu is, for a reader, and what its search says. */
const LANGUAGE_MENU = {
  LABEL: "Language",
  PLACEHOLDER: "Search languages",
  NO_MATCH: "No language matches",
} as const;

/** How a fenced block is headed: its language's glyph where it has a name here, the title, and whether that title is a name or words. */
export interface FenceHeading {
  readonly glyph: ReactNode;
  readonly title: string;
  readonly titleIs: CodeCardTitle;
}

/** Whether a block fenced in `language` is a change suggested to a review comment's lines: one written ```suggestion, or one GitHub rendered. */
export function suggests(language: string): boolean {
  return language === SUGGESTION_LANGUAGE || language === SUGGESTED_CHANGE_LANGUAGE;
}

/** The heading of a block fenced in `language`; a suggestion's under its name, which names no language of its own. */
export function fenceHeading(language: string): FenceHeading {
  if (suggests(language)) {
    return { glyph: undefined, title: SUGGESTION_LABEL, titleIs: CODE_CARD_TITLE.WORDS };
  }
  const { extension, name } = codeLanguage(language);
  return {
    glyph: name === undefined ? undefined : <FileTypeIcon name={`code.${extension}`} />,
    title: codeTitle(language),
    titleIs: name === undefined ? CODE_CARD_TITLE.NAME : CODE_CARD_TITLE.WORDS,
  };
}

/** The languages the menu lists, each by its name and its file icon. */
const LANGUAGE_ROWS: readonly MenuRow[] = CODE_LANGUAGE_CHOICES.map(({ id, name }) =>
  id === ""
    ? { id, label: name }
    : { id, label: name, icon: <FileTypeIcon name={`code.${id}`} />, terms: [id] },
);

/**
 * The header of a block open in a text's editor: the drawn card's own
 * header (`fenceHeading`), its Copy copying the block's lines as they stand,
 * and its title a press opening the languages under it, as a Notion code
 * block's is, a pick setting the block's language. The menu closes on a pick, on
 * Escape, and on focus leaving it, and a close hands the keyboard back to
 * the title.
 */
export function EditorCodeHeader({ block }: { block: EditorCodeBlock }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const held = useRef<HTMLSpanElement>(null);
  const heading = fenceHeading(block.language);
  const close = () => {
    setOpen(false);
    held.current?.querySelector("button")?.focus();
  };
  return (
    <span ref={held} className="contents">
      <CodeCardHeader
        glyph={heading.glyph}
        title={heading.title}
        titleIs={heading.titleIs}
        copied={block.code}
        copy={copyThroughShell}
        picker={{
          label: `${LANGUAGE_MENU.LABEL}: ${heading.title}`,
          open,
          menuId,
          onPress: () => setOpen(!open),
          menu: drawn.mounted ? (
            <SearchableMenu
              leaving={drawn.leaving}
              ref={drawn.ref}
              id={menuId}
              label={LANGUAGE_MENU.LABEL}
              placeholder={LANGUAGE_MENU.PLACEHOLDER}
              rows={LANGUAGE_ROWS}
              value={codeLanguageChoice(block.language)?.id}
              noMatch={LANGUAGE_MENU.NO_MATCH}
              align={POPOVER_ALIGN.START}
              side={POPOVER_SIDE.BELOW}
              width={POPOVER_WIDTH.NARROW}
              replayUnmasked
              onPick={(id) => {
                setOpen(false);
                block.setLanguage(id);
              }}
              onClose={close}
              onLeave={(left) => {
                if (!(left instanceof Node && held.current?.contains(left))) setOpen(false);
              }}
            />
          ) : null,
        }}
      />
    </span>
  );
}
