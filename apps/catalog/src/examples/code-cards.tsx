import {
  CODE_CARD_TITLE,
  CODE_ROW,
  CodeCard,
  CodeCardHeader,
  CodeEditor,
  CodePreview,
  FileCodeCard,
  TerminalIcon,
  TextButton,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * code-cards.tsx -- the one card for a block of code: a short block headed
 * by its language, one headed by its language's name after its glyph, one headed by its file with the host's colors on its
 * runs, a block of 60 lines cut at 40 behind Show all, a suggestion drawn
 * as rows on the added and removed grounds, a body the caller draws under
 * a header with an action of its own, and a file's lines with the file's
 * opening beside the Copy, as an Inbox item's code stands; the header
 * alone, its language a press opening its menu, as a block open in a
 * text's editor wears it; and a code
 * editor over the same colored lines, its edited lines drawn plain until
 * colored again, one numbering a script's dozen lines in a gutter as a script's
 * editor does, and an empty one with its placeholder. The catalog's
 * copy act is the browser's own clipboard; an app hands in its shell's.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const SHORT = ["pnpm install", "pnpm exec vitest run packages/ui"].join("\n");

/** A setup script past nine lines, so the gutter stands two digits wide and draws each two-digit number whole. */
const SCRIPT = [
  "# Start the database the tests run against.",
  "docker run --detach --name catalog-postgres --publish 5432:5432 postgres:18",
  "for _ in $(seq 1 60); do",
  "  docker exec catalog-postgres pg_isready --quiet && break",
  "  sleep 1",
  "done",
  "",
  "export DATABASE_URL=postgresql://catalog:catalog@localhost:5432/catalog",
  "pnpm install",
  "pnpm --filter @repo/web db:migrate",
  'echo "The database is up and migrated at $DATABASE_URL"',
  "pnpm exec vitest run packages/ui",
].join("\n");

const COLORED = [
  'import { CODE_CARD_TITLE, CODE_ROW, CodeCard, TextButton } from "@repo/ui";',
  "",
  "export const cut = 40;",
].join("\n");

/** The colors the host's highlighter hands for `COLORED`, GitHub's own in each appearance. */
const COLORED_LINES = [
  [
    { text: "import", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " { CodeCard } " },
    { text: "from", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " " },
    { text: '"@repo/ui"', color: "#a5d6ff", lightColor: "#0a3069" },
    { text: ";" },
  ],
  [],
  [
    { text: "export const", color: "#ff7b72", lightColor: "#cf222e" },
    { text: " " },
    { text: "cut", color: "#79c0ff", lightColor: "#0550ae" },
    { text: " = " },
    { text: "40", color: "#79c0ff", lightColor: "#0550ae" },
    { text: ";" },
  ],
];

const SUGGESTION = ["const days = 30;", "const days = 7;", "export default days;"];

const LONG = Array.from(
  { length: 60 },
  (_, at) => `  step${at + 1}: "Line ${at + 1} of the block",`,
).join("\n");

/** A code editor over `COLORED`, holding its colors for the lines they still spell, as the host's would arrive a moment after a keystroke. */
function EditedCode(): React.JSX.Element {
  const [code, setCode] = useState(COLORED);

  return <CodeEditor label="Colored code" value={code} onChange={setCode} lines={COLORED_LINES} />;
}

/** A code editor numbering its lines, as a script's stands, a few lines tall while it holds fewer. */
function NumberedCode(): React.JSX.Element {
  const [code, setCode] = useState(SCRIPT);

  return <CodeEditor label="Numbered code" value={code} onChange={setCode} rows={3} lineNumbers />;
}

/** An empty code editor, its placeholder standing. */
function EmptyCode(): React.JSX.Element {
  const [code, setCode] = useState("");

  return (
    <CodeEditor label="Empty code" value={code} onChange={setCode} placeholder={SHORT} rows={3} />
  );
}

/** The header alone, its language a press, as a block open in a text's editor wears it; the press here only says the menu is open. */
function PickedLanguage(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <CodeCardHeader
      glyph={<TerminalIcon />}
      title="Shell"
      titleIs={CODE_CARD_TITLE.WORDS}
      copied={SHORT}
      copy={copyToClipboard}
      picker={{
        label: "Language: Shell",
        open,
        menuId: "catalog-code-language",
        onPress: () => setOpen(!open),
        menu: null,
      }}
    />
  );
}

function CodeCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="code-card-language" title="Headed by its language">
        <CodeCard title="shell" code={SHORT} copy={copyToClipboard} />
      </CatalogSection>
      <CatalogSection id="code-card-glyph" title="Headed by its language's name, after its glyph">
        <CodeCard
          glyph={<TerminalIcon />}
          title="Shell"
          titleIs={CODE_CARD_TITLE.WORDS}
          code={SHORT}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-file" title="Headed by its file, colored by the host">
        <CodeCard
          title="packages/ui/src/cut.ts"
          code={COLORED}
          lines={COLORED_LINES}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection
        id="code-preview"
        title="A preview of a script's first lines, the rest fading out"
      >
        <CodePreview code={SCRIPT} />
        <CodePreview code={COLORED} lines={COLORED_LINES} />
        <CodePreview code={SHORT} />
      </CatalogSection>
      <CatalogSection id="code-card-cut" title="Cut at 40 lines, with Show all">
        <CodeCard title="yaml" code={LONG} copy={copyToClipboard} />
      </CatalogSection>
      <CatalogSection id="code-card-rows" title="Drawn as rows, copying its new lines">
        <CodeCard
          title="Suggested change"
          titleIs={CODE_CARD_TITLE.WORDS}
          code={SUGGESTION.join("\n")}
          rows={[CODE_ROW.REMOVED, CODE_ROW.ADDED, CODE_ROW.ADDED]}
          copied={SUGGESTION.slice(1).join("\n")}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-body" title="A body of the caller's own, with an action">
        <CodeCard
          title="packages/ui/src/cut.ts"
          body="Drawn by the caller, not cut."
          copied={COLORED}
          actions={<TextButton onClick={() => {}}>Open file</TextButton>}
          copy={copyToClipboard}
        />
      </CatalogSection>
      <CatalogSection id="code-card-file-open" title="A file's lines, with the file's opening">
        <FileCodeCard
          title="packages/ui/src/cut.ts"
          label="packages/ui/src/cut.ts, Line 3"
          body="The lines, as the caller draws them."
          copied="export const cut = 40;"
          copy={copyToClipboard}
          onOpen={() => {}}
        />
      </CatalogSection>
      <CatalogSection id="code-card-header-picker" title="The header alone, its language a press">
        <PickedLanguage />
      </CatalogSection>
      <CatalogSection
        id="code-editor"
        title="A code editor, colored where its colors still spell a line"
      >
        <EditedCode />
      </CatalogSection>
      <CatalogSection id="code-editor-numbered" title="A code editor numbering its lines">
        <NumberedCode />
      </CatalogSection>
      <CatalogSection id="code-editor-empty" title="An empty code editor, with its placeholder">
        <EmptyCode />
      </CatalogSection>
    </>
  );
}

export const CODE_CARDS_EXAMPLE: Example = {
  id: "code-cards",
  title: "Code cards",
  Render: CodeCards,
};
