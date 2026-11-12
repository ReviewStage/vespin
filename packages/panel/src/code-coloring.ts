/**
 * code-coloring.ts -- code colored by main's one highlighter, asked once per language and words: a transcript's fenced block, and a script as it is typed.
 */

import type { CodeLines } from "@repo/features/tasks-view";
import { ACT_KIND, COLORED_CODE_MAX_CHARS, FENCE_LANGUAGE_MAX_CHARS } from "@repo/host/acts";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { askAct } from "./act.js";
import { QUERY_ROOT } from "./query-keys.js";

/**
 * A block's coloring, asked of main the first time it is wanted and held for
 * the window's life while drawn, since a block's colors never change; one let
 * go of no longer drawn is forgotten after Query's garbage-collection time.
 * Note that a refusal draws the block plain and is held as one, so it is not
 * asked again.
 */
export function coloringQueryOptions(language: string, code: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.CODE_COLORING, language, code],
    queryFn: (): Promise<CodeLines | null> =>
      askAct(ACT_KIND.TASKS_COLOR_CODE, { language, code }).catch(() => null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Whether main is asked to color a block at all: a named language, and code within the bound. */
export function colorable(language: string, code: string): boolean {
  return (
    language !== "" &&
    language.length <= FENCE_LANGUAGE_MAX_CHARS &&
    code.trim() !== "" &&
    code.length <= COLORED_CODE_MAX_CHARS
  );
}

/**
 * The coloring of code being typed, asked again as its words change: the
 * last coloring answered stands while the next is asked, so the lines it
 * still spells stay colored rather than blinking plain on every keystroke
 * (`CodeEditor` draws a line in it only where it spells that line).
 */
export function useTypedCodeColoring(language: string, code: string): CodeLines | undefined {
  const asking = colorable(language, code);

  const coloring = useQuery({
    ...coloringQueryOptions(language, code),
    enabled: asking,
    placeholderData: keepPreviousData,
  });

  return asking ? (coloring.data ?? undefined) : undefined;
}
