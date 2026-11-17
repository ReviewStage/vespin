import { CLAWD_PATH, CURSOR_PATH } from "@repo/brand/provider-marks";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * harness-mark.tsx -- the mark of the harness a coding agent's model runs in: Claude Code's Clawd for Anthropic's models, Codex's own cloud for OpenAI's, Cursor's cube for Cursor's.
 *
 * Claude Code's Clawd, verbatim from `resources/clawd.svg` in Anthropic's own
 * Claude Code extension for VS Code (publisher Anthropic, version 2.1.296),
 * in its own clay, its path from `@repo/brand`'s table, which the iOS app's
 * agent tile draws too. Anthropic's press kit carries the Claude Code wordmark
 * but no mark of Clawd alone. Codex's is OpenAI's picture, drawn from the
 * files the app serves (`CodexArt`). Cursor's is its cube from `@repo/brand`'s
 * table, in the text's own ink, as Cursor's brand files draw it. Each fills the glyph cell of the
 * row, tab, or chip it leads, which sizes it.
 */

/** Codex's picture, as the addresses the app serves it at one, two, and three device pixels to the pixel. */
export interface CodexArt {
  readonly oneX: string;
  readonly twoX: string;
  readonly threeX: string;
}

/** A harness's mark: Codex's needs its picture's addresses, Claude's and Cursor's none. */
export type HarnessMarkProps =
  | {
      readonly provider: typeof MODEL_PROVIDER.ANTHROPIC | typeof MODEL_PROVIDER.CURSOR;
      readonly codexArt?: CodexArt;
    }
  | { readonly provider: typeof MODEL_PROVIDER.OPENAI; readonly codexArt: CodexArt };

/** The mark of the harness a provider's models run in, for the rows, tabs, and chips that name an agent or a model. */
export function HarnessMark({ provider, codexArt }: HarnessMarkProps): React.JSX.Element {
  if (provider === MODEL_PROVIDER.OPENAI) {
    return (
      <img
        className="ui-harness-mark"
        data-provider={provider}
        src={codexArt.oneX}
        srcSet={`${codexArt.oneX} 1x, ${codexArt.twoX} 2x, ${codexArt.threeX} 3x`}
        alt=""
        draggable={false}
      />
    );
  }

  if (provider === MODEL_PROVIDER.CURSOR) {
    return (
      <svg
        className="ui-harness-mark"
        data-provider={provider}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path fill="currentColor" d={CURSOR_PATH} />
      </svg>
    );
  }

  return (
    <svg
      className="ui-harness-mark"
      data-provider={provider}
      viewBox="0 0 47 38"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#D97757" d={CLAWD_PATH} />
    </svg>
  );
}
