/**
 * pull-request-branches.tsx -- the branches a pull request merges, in its header: one line of words, as GitHub writes them.
 *
 * The branch it merges into, then the one it merges from (`main ← topic`),
 * after a branch's glyph, in the code face and the line's muted ink: words
 * that say where the pull request stands rather than presses, so the line
 * under the title reads as its facts and leaves its presses to the stack
 * and the pickers. Each may be selected and copied as any words may, and
 * names itself whole in its hint. Where the row runs short the head gives
 * way, cut at its start so its last words, which tell one branch of a stack
 * from the next, stand whole, and the base stands whole, since a base is
 * short (`main`) and a cut one reads as nothing (`mai`); a base longer than
 * half the row is cut to that half, so the head keeps the other. A head on
 * a fork is named as GitHub names it, by the fork's account and its branch
 * (`octocat:patch-1`).
 */

import { TEXT_ELEMENT, TEXT_FONT, TEXT_TRUNCATE, TEXT_VARIANT, Text, Tooltip } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";

/** A head's name as GitHub writes it: its branch, after its fork's account where it stands on a fork. */
function headName(head: string, owner: string | undefined): string {
  return owner === undefined ? head : `${owner}:${head}`;
}

/** How a branch's name takes the row's room: the base kept whole, the head giving way. */
const NAME_ROOM = {
  BASE: "max-w-branch-base flex-none",
  HEAD: "max-w-branch-chip flex-[0_1_auto]",
} as const;

type NameRoom = (typeof NAME_ROOM)[keyof typeof NAME_ROOM];

/** One branch's name in the code face, whole in its hint, taking the row's room as `room` says. */
function BranchName({ name, room }: { name: string; room: NameRoom }): React.JSX.Element {
  return (
    <Tooltip label={name}>
      <span className={`inline-flex min-w-0 ${room}`}>
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          font={TEXT_FONT.MONO}
          truncate={room === NAME_ROOM.HEAD ? TEXT_TRUNCATE.START : true}
        >
          {name}
        </Text>
      </span>
    </Tooltip>
  );
}

/** The branch it merges into, then the one it merges from, as words after a branch's glyph. */
export function PullRequestBranches({
  base,
  head,
  headOwner,
}: {
  base: string;
  head: string;
  /** The account whose fork its head stands on, where it is not the repository's own. */
  headOwner?: string | undefined;
}): React.JSX.Element {
  return (
    <span className="pull-request-branches inline-flex min-w-0 max-w-full items-center gap-tight-gap whitespace-nowrap select-text">
      <span className="pull-request-branches-mark inline-flex flex-none" aria-hidden="true">
        <GLYPH.BRANCH />
      </span>
      <BranchName name={base} room={NAME_ROOM.BASE} />
      <span className="flex-none" aria-hidden="true">
        {" ← "}
      </span>
      <BranchName name={headName(head, headOwner)} room={NAME_ROOM.HEAD} />
    </span>
  );
}
