import { REPLY_BUTTON_KIND, ReplyButton } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * reply-buttons.tsx -- buttons an agent put in its reply, each after the
 * line it is about: one that starts a new agent and one that sends to a
 * running one, resting on either hanging what it does over the brief, one
 * pressing, and the same pair as a phone draws them, where a press opens
 * the brief with the act's own button first.
 */

const START = {
  label: "Wire up the invite email",
  kind: REPLY_BUTTON_KIND.START,
  glyph: <GLYPH.AGENT />,
  where: "acme/relay · main · Sonnet 5.5 high",
  brief:
    "The invite email is only written to the log, never sent. Send it through the mail " +
    "provider the app already uses for password resets, retry a bounce once, and add a test " +
    "that an invitation sends exactly one email.",
} as const;

const SEND = {
  label: "Tell the reviewer",
  kind: REPLY_BUTTON_KIND.SEND,
  glyph: <GLYPH.SEND />,
  where: "To Review the invite flow",
  brief: "The accept path moved to InvitationToken on main; read that one, not the old route.",
} as const;

function ReplyButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="reply-buttons-pointer" title="Under a pointer: a press runs it">
        <p>
          The invite email is only written to the log, never sent.{" "}
          <ReplyButton {...START} onPress={() => undefined} />
        </p>
        <p>
          The reviewer agent is still reading the old accept path.{" "}
          <ReplyButton {...SEND} onPress={() => undefined} />
        </p>
        <p>
          While its press runs. <ReplyButton {...START} pressing onPress={() => undefined} />
        </p>
      </CatalogSection>
      <CatalogSection id="reply-buttons-confirm" title="On a phone: a press opens the brief first">
        <p>
          The invite email is only written to the log, never sent.{" "}
          <ReplyButton {...START} confirmFirst onPress={() => undefined} />
        </p>
      </CatalogSection>
    </>
  );
}

export const REPLY_BUTTONS_EXAMPLE: Example = {
  id: "reply-buttons",
  title: "Reply buttons",
  Render: ReplyButtons,
};
