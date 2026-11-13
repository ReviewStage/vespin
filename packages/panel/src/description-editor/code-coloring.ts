import type { CodeLines, CodeToken } from "@repo/features/tasks-view";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { CodeColorer } from "./contract.js";

/**
 * code-coloring.ts -- a code block open in the editor colored as the drawn text's card colors it: each run the host's one highlighter answers, laid over the block's lines.
 *
 * The drawn card colors a block's lines by the host's highlighter (`@repo/ui`'s
 * `CodeCard`), so the editor asks the panel for the same coloring
 * (`CodeColorer`), which the panel answers from the read the card already
 * made, and a block opened to be edited stands in the colors it was drawn in.
 * Each run is a span wearing its color in each appearance as the card's runs
 * wear it, the custom properties the lines' classes pick between
 * (`@repo/ui/code-face`). As a block's words change, the colors laid on
 * follow its words until the coloring of its new words lands, so a line being
 * typed never blinks plain; a coloring that lands for words no block holds any
 * longer lays nothing.
 */

/** The node a fenced block is, as StarterKit names it. */
const CODE_BLOCK = "codeBlock";

const COLORING = new PluginKey<DecorationSet>("codeColoring");

/** A block of code where it stands: its node, the position of its first character, and its language. */
interface CodeBlock {
  readonly node: PmNode;
  readonly start: number;
  readonly language: string;
}

/** A coloring that landed, by the language and words it colors. */
interface Landed {
  readonly language: string;
  readonly code: string;
}

/** What a run's span wears: its color in each appearance, as the card's runs wear it; none for the code's own ink. */
function runStyle({ color, lightColor }: CodeToken): string | undefined {
  const colors = [
    ...(color === undefined ? [] : [`--ui-code-run-dark: ${color}`]),
    ...(lightColor === undefined ? [] : [`--ui-code-run-light: ${lightColor}`]),
  ];

  return colors.length === 0 ? undefined : colors.join("; ");
}

/** A block's runs as decorations from `start`, its first character; a line the coloring does not spell is left plain. */
function runsOf(start: number, code: string, lines: CodeLines): Decoration[] {
  const runs: Decoration[] = [];
  let lineStart = start;

  code.split("\n").forEach((line, index) => {
    const tokens = lines[index] ?? [];

    if (tokens.map((token) => token.text).join("") === line) {
      let from = lineStart;

      for (const token of tokens) {
        const style = runStyle(token);
        const to = from + token.text.length;

        if (style !== undefined && to > from) runs.push(Decoration.inline(from, to, { style }));
        from = to;
      }
    }

    lineStart += line.length + 1;
  });

  return runs;
}

/** Every code block in the document, nested ones among them. */
function blocksOf(doc: PmNode): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== CODE_BLOCK) return !node.isTextblock;
    blocks.push({ node, start: pos + 1, language: String(node.attrs.language ?? "") });

    return false;
  });

  return blocks;
}

/**
 * The plugin coloring each code block by `colorCode`, asked once for each
 * language and words a block holds. Note that a block's node is the same
 * object until its words or language change, so the nodes already colored
 * are known by identity, and only a block that changed is colored again.
 */
export function codeColoring(colorCode: CodeColorer): Plugin<DecorationSet> {
  // Each coloring asked for, by language and then words: its lines once landed, null where nothing colors them, undefined while asked.
  const answers = new Map<string, Map<string, CodeLines | null | undefined>>();
  const colored = new WeakSet<PmNode>();
  const answerOf = (language: string, code: string) => answers.get(language)?.get(code);
  // Note that the editor builds its plugins' views anew as it is set up, so a coloring lands on the view standing when it does.
  let shown: EditorView | undefined;

  /** The decorations with each block's runs laid anew where its coloring has landed, those not landed left following its words. */
  const laid = (set: DecorationSet, doc: PmNode, blocks: readonly CodeBlock[]) =>
    blocks.reduce((each, { node, start, language }) => {
      const lines = answerOf(language, node.textContent);

      if (lines === undefined) return each;
      colored.add(node);
      const old = each.find(start, start + node.content.size);

      return each
        .remove(old)
        .add(doc, lines === null ? [] : runsOf(start, node.textContent, lines));
    }, set);

  return new Plugin<DecorationSet>({
    key: COLORING,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const landed: Landed | undefined = tr.getMeta(COLORING);
        const mapped = set.map(tr.mapping, tr.doc);

        if (landed === undefined && !tr.docChanged) return mapped;

        const blocks = blocksOf(tr.doc).filter((block) =>
          landed === undefined
            ? !colored.has(block.node)
            : block.language === landed.language && block.node.textContent === landed.code,
        );

        return laid(mapped, tr.doc, blocks);
      },
    },
    props: { decorations: (state) => COLORING.getState(state) },
    view: (view) => {
      shown = view;

      const ask = (doc: PmNode) => {
        for (const { node, language } of blocksOf(doc)) {
          const code = node.textContent;
          const held = answers.get(language) ?? new Map<string, CodeLines | null | undefined>();
          answers.set(language, held);

          if (held.has(code)) continue;
          held.set(code, undefined);
          void colorCode(language, code).then((lines) => {
            held.set(code, lines);
            const landed: Landed = { language, code };
            shown?.dispatch(
              shown.state.tr.setMeta(COLORING, landed).setMeta("addToHistory", false),
            );
          });
        }
      };

      ask(view.state.doc);

      return {
        update: (next, before) => {
          if (!next.state.doc.eq(before.doc)) ask(next.state.doc);
        },
        destroy: () => {
          if (shown === view) shown = undefined;
        },
      };
    },
  });
}
