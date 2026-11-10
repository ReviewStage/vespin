import { DraftCard, TextLink } from "@repo/ui";
import { DRAFT_KIND, type DraftCopy } from "@repo/ui/draft-text";
import type { ReactNode } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * draft-cards.tsx -- words an agent wrote to be sent elsewhere, drawn as
 * they will look when sent: a Slack message with its bold, italic, struck
 * words, code span, and labeled link, an email under its subject, and a
 * plain draft, each line break where it was written. The catalog's copy
 * acts are the browser's own clipboard, the rich one with its HTML beside
 * its words; an app hands in its shell's.
 */

const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const copyRich = ({ html, text }: DraftCopy): Promise<void> =>
  navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    }),
  ]);

const link = (url: string, children: ReactNode): ReactNode => (
  <TextLink href={url}>{children}</TextLink>
);

const SLACK = [
  "Hey team :wave: *the release is out* and _mostly_ smooth.",
  "",
  "• The iOS build ~failed~ passed on retry",
  "• Run `pnpm check:affected` before you push",
  "",
  "Notes are in <https://example.com/notes|the release doc>.",
].join("\n");

const EMAIL = [
  "Subject: Thursday's review, moved to 3 PM",
  "",
  "Hi Sam,",
  "",
  "Could we move Thursday's review to 3 PM? The build lands at noon.",
  "",
  "Thanks,",
  "Alex",
].join("\n");

const DRAFT = ["Shipped the draft blocks.", "Copy keeps the formatting."].join("\n");

function DraftCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection
        id="draft-card-slack"
        title="A Slack message, its marks and link as Slack draws them"
      >
        <DraftCard
          kind={DRAFT_KIND.SLACK}
          text={SLACK}
          link={link}
          copy={copyRich}
          copyText={copyText}
        />
      </CatalogSection>
      <CatalogSection id="draft-card-email" title="An email under its subject">
        <DraftCard
          kind={DRAFT_KIND.EMAIL}
          text={EMAIL}
          link={link}
          copy={copyRich}
          copyText={copyText}
        />
      </CatalogSection>
      <CatalogSection id="draft-card-draft" title="A plain draft">
        <DraftCard
          kind={DRAFT_KIND.DRAFT}
          text={DRAFT}
          link={link}
          copy={copyRich}
          copyText={copyText}
        />
      </CatalogSection>
    </>
  );
}

export const DRAFT_CARDS_EXAMPLE: Example = {
  id: "draft-cards",
  title: "Draft cards",
  Render: DraftCards,
};
