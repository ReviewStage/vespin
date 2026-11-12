import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { ProviderMark, SuggestionCard, SuggestionCards, TEXT_TONE, Text } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * suggestion-cards.tsx -- what the app suggests starting, as cards in a grid
 * that wraps under their heading: two that start on a press, one that
 * needs an integration connected first and says so at its foot, the same
 * for a reader who can only ask for it, faded, and one that cannot start
 * yet, faded. The line under them says which was pressed.
 */

function SuggestionCardsExample(): React.JSX.Element {
  const [pressed, setPressed] = useState("Nothing yet");

  return (
    <CatalogSection id="suggestion-cards" title="Suggested">
      <SuggestionCards title="Suggested">
        <SuggestionCard
          glyph={<GLYPH.MEMORY />}
          name="Memory digest"
          detail="Every Monday, posts the memories agents kept or corrected that week to your Inbox, and deletes the ones you mark."
          onPress={() => setPressed("Memory digest")}
        />
        <SuggestionCard
          glyph={<GLYPH.MEMORY />}
          name="Weekly summary"
          detail="Every Friday, sums up what the week's tasks shipped."
          onPress={() => setPressed("Weekly summary")}
        />
        <SuggestionCard
          glyph={<ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />}
          name="Investigate Sentry alerts"
          detail="When a Sentry alert fires, reads the issue and its stack trace, then opens a fix or posts what it found."
          needs={{
            mark: <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />,
            words: "Connect Sentry",
          }}
          onPress={() => setPressed("Investigate Sentry alerts")}
        />
        <SuggestionCard
          glyph={<ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />}
          name="Investigate Sentry alerts"
          detail="A member who cannot connect Sentry is told whom to ask, and the card takes no press."
          needs={{
            mark: <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />,
            words: "Ask an owner or admin to connect Sentry",
          }}
          disabled
          onPress={() => setPressed("The card asking for Sentry")}
        />
        <SuggestionCard
          glyph={<GLYPH.MEMORY />}
          name="Choose a workspace first"
          detail="A suggestion that cannot start yet stands faded and takes no press."
          disabled
          onPress={() => setPressed("The faded card")}
        />
      </SuggestionCards>
      <Text tone={TEXT_TONE.MUTED}>Pressed: {pressed}</Text>
    </CatalogSection>
  );
}

export const SUGGESTION_CARDS_EXAMPLE: Example = {
  id: "suggestion-cards",
  title: "Suggestion cards",
  Render: SuggestionCardsExample,
};
