import {
  CLAUDE_PATH,
  CLAUDE_VIEW_BOX,
  CURSOR_PATH,
  OPENAI_PATH,
  OPENAI_VIEW_BOX,
} from "@repo/brand/provider-marks";
import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * harness-mark.tsx -- the mark of the harness a coding agent's model runs in: Claude's spark for Anthropic's models, OpenAI's blossom for OpenAI's, Cursor's cube for Cursor's.
 *
 * One mark per company, the same on an agent, its models, and the plans and
 * keys that pay for it, as Zed, VS Code, and GitHub draw them (the developer,
 * Nov 25, 2026). Claude's spark is Anthropic's own, in its own clay. OpenAI's
 * blossom and Cursor's cube are one ink each, as their brand files draw them,
 * in the text's own. Every path is `@repo/brand`'s, which the iOS app's agent
 * tile draws too. Each fills the glyph cell of the row, tab, or chip it
 * leads, which sizes it.
 */

/** The mark of the harness a provider's models run in, for the rows, tabs, and chips that name an agent or a model. */
export function HarnessMark({ provider }: { readonly provider: ModelProvider }): React.JSX.Element {
  if (provider === MODEL_PROVIDER.OPENAI) {
    return (
      <svg
        className="ui-harness-mark"
        data-provider={provider}
        viewBox={OPENAI_VIEW_BOX}
        aria-hidden="true"
        focusable="false"
      >
        <path fill="currentColor" d={OPENAI_PATH} />
      </svg>
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
      viewBox={CLAUDE_VIEW_BOX}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#D97757" d={CLAUDE_PATH} />
    </svg>
  );
}
