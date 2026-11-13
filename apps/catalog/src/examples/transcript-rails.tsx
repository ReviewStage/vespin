import {
  AVATAR_OUTLINE,
  AVATAR_SIZE,
  Avatar,
  Badge,
  Comment,
  type CommentAuthor,
  HoverCard,
  HoverCardNote,
  QuietWords,
  TIME_LOOK,
  Time,
  TranscriptRail,
  type TranscriptRailMark,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * transcript-rails.tsx -- the rail down a conversation's leading edge: a
 * tick in the accent for each of the reader's own lines and a dot for
 * everyone else's, the lines standing in the view lit, the ticks near the
 * pointer widening, a mark's card hung as a comment of its line, and a press
 * going to the line, said under the frame. On a phone's room the rail is one
 * press listing every line in a sheet, each under its sender's face and
 * name, the reader's own badged, and its words on at most two lines.
 */

const MINUTE = 60_000;

/** Who sent each line, as its card's comment heads it. */
const AUTHORS = {
  YOU: { name: "Ada Lovelace", id: "user-ada" },
  GRACE: { name: "Grace Hopper", id: "user-grace" },
  AGENT: { name: "Invite emails", id: "agent-invite", outline: AVATAR_OUTLINE.SQUARE },
  GITHUB: { name: "review-bot", id: "github-review-bot" },
} as const satisfies Record<string, CommentAuthor>;

/** The lines sent into the agent, oldest first, with who sent each and how long ago. */
const LINES = [
  {
    key: "ask",
    author: AUTHORS.YOU,
    words: "Build teammate invitations from the description.",
    ago: 90,
  },
  {
    key: "grace",
    author: AUTHORS.GRACE,
    words: "What happens if two people open the same link at once?",
    ago: 70,
  },
  {
    key: "review",
    author: AUTHORS.GITHUB,
    words: "One note on the expiry check; the rest reads well.",
    ago: 64,
  },
  {
    key: "pending",
    author: AUTHORS.YOU,
    words: "Show invited people under Members with a Pending badge.",
    ago: 52,
  },
  {
    key: "agent",
    author: AUTHORS.AGENT,
    words: "Rebase before you push: sendInvite takes the workspace's name now.",
    ago: 40,
  },
  {
    key: "conflict",
    author: AUTHORS.YOU,
    words: "Answer a used link with a 409 rather than a 404.",
    ago: 28,
  },
  {
    key: "squash",
    author: AUTHORS.YOU,
    words: "Squash it into one commit and rewrite the description.",
    ago: 6,
  },
] as const;

/** The lines standing in the example's view, as a scrolled conversation would light them. */
const SHOWN: ReadonlySet<string> = new Set(["agent", "conflict"]);

function TranscriptRails(): React.JSX.Element {
  // Note that the ages count from the catalog's own load, so each reads the same on every draw.
  const now = Date.now();
  const [went, setWent] = useState<string | undefined>(undefined);

  const marks = LINES.map(
    (line): TranscriptRailMark => ({
      key: line.key,
      own: line.author === AUTHORS.YOU,
      sender: line.author === AUTHORS.YOU ? "You" : line.author.name,
      words: line.words,
      face: (
        <Avatar
          name={line.author.name}
          id={line.author.id}
          outline={"outline" in line.author ? line.author.outline : AVATAR_OUTLINE.CIRCLE}
          size={AVATAR_SIZE.INLINE}
          decorative
        />
      ),
      tag: (
        <>
          {line.author === AUTHORS.YOU ? <Badge>You</Badge> : null}
          <QuietWords>
            <Time at={now - line.ago * MINUTE} now={now} look={TIME_LOOK.SINCE} hint={false} />
          </QuietWords>
        </>
      ),
      shown: SHOWN.has(line.key),
    }),
  );

  const cardOf = (key: string) => {
    const line = LINES.find((each) => each.key === key);

    if (line === undefined) return null;

    return (
      <HoverCard>
        <Comment author={line.author} at={now - line.ago * MINUTE} now={now}>
          <HoverCardNote>{line.words}</HoverCardNote>
        </Comment>
      </HoverCard>
    );
  };

  const wentTo = LINES.find((line) => line.key === went);

  return (
    <>
      <CatalogSection id="transcript-rail" title="A rail of seven lines, four the reader's">
        <div className="catalog-frame catalog-rail">
          <TranscriptRail marks={marks} narrow={false} cardOf={cardOf} onJump={setWent} />
        </div>
        <QuietWords>
          {wentTo === undefined ? "Press a mark to go to its line." : `Went to: ${wentTo.words}`}
        </QuietWords>
      </CatalogSection>
      <CatalogSection id="transcript-rail-narrow" title="On a phone: one press listing every line">
        <div className="catalog-frame catalog-rail">
          <TranscriptRail marks={marks} narrow cardOf={cardOf} onJump={setWent} />
        </div>
      </CatalogSection>
    </>
  );
}

export const TRANSCRIPT_RAILS_EXAMPLE: Example = {
  id: "transcript-rails",
  title: "Transcript rails",
  Render: TranscriptRails,
};
