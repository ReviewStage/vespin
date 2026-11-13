import {
  HOVER_CARD_ROW_LOOK,
  HoverCardRow,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  SUGGESTION_KIND,
  Suggestion,
  SuggestionSent,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * suggestions.tsx -- suggestions an agent put in its reply, each after the
 * line it is about: one of a new agent, whose card says where it would run
 * row by row, and one of a message to a running agent, whose card names that
 * agent's chip. Resting on either hangs the card; a press opens the draft.
 * Once sent, a suggestion is the chip of the agent it reached, Started or
 * Sent after its name.
 */

const BRIEF =
  "The invite email is only written to the log, never sent. Send it through the mail " +
  "provider the app already uses for password resets, retry a bounce once, and add a test " +
  "that an invitation sends exactly one email.";

function Suggestions(): React.JSX.Element {
  return (
    <CatalogSection id="suggestions" title="In a reply: a press opens the draft">
      <p>
        The invite email is only written to the log, never sent.{" "}
        <Suggestion
          label="Wire up the invite email"
          kind={SUGGESTION_KIND.START}
          where={
            <>
              <HoverCardRow
                look={HOVER_CARD_ROW_LOOK.DETAIL}
                glyph={<GLYPH.REPOSITORY />}
                label="acme/relay"
              />
              <HoverCardRow
                look={HOVER_CARD_ROW_LOOK.DETAIL}
                glyph={<GLYPH.BRANCH />}
                label="Default branch"
              />
            </>
          }
          brief={BRIEF}
          onPress={() => undefined}
        />
      </p>
      <p>
        The digest still counts a pending invite as a member.{" "}
        <Suggestion
          label="Tell the digest agent"
          kind={SUGGESTION_KIND.SEND}
          target={
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<GLYPH.AGENT />}
              label="Send the weekly digest"
              name={INLINE_REF_NAME.WHOLE}
            />
          }
          brief="Invitations now stand apart from members: count a pending invite as an invite."
          onPress={() => undefined}
        />
      </p>
      <p>
        Once sent, it is the agent it reached.{" "}
        <InlineRef
          look={INLINE_REF_LOOK.PILL}
          glyph={<GLYPH.AGENT />}
          label="Wire up the invite email"
          name={INLINE_REF_NAME.WHOLE}
          state={<SuggestionSent kind={SUGGESTION_KIND.START} />}
        />
      </p>
    </CatalogSection>
  );
}

export const SUGGESTIONS_EXAMPLE: Example = {
  id: "suggestions",
  title: "Suggestions",
  Render: Suggestions,
};
