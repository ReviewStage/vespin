import {
  GROUP_HEAD,
  GROUP_HEADING,
  GROUP_LOOK,
  GROUP_ROW_LEAD,
  GroupHeader,
  LIST_HEADS_ACTS,
  LIST_HEADS_LEAD,
  List,
  ListHead,
  ListHeads,
  ListRow,
  SETTINGS_SKELETON_CONTROL,
  SettingsControlSkeleton,
  SKELETON_KIND,
  Skeleton,
  Toolbar,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import { sidebarHead } from "./sidebar-fold.js";

/**
 * automation-list-frame.tsx -- the Automations list's boxes, which the list and its placeholders both draw.
 *
 * The list's toolbar, an owner's list, and a row's owner and next run each
 * stand in one component here, drawn by the list with what it
 * read and by its placeholder with blocks, so the placeholder is the list's
 * own shape rather than a copy of it. It stands outside the Automations
 * pages' chunk (`desktop-shell.tsx`), so what the window draws while that
 * chunk loads draws through the same boxes.
 */

/** A group of automations, one owner's, a page section below the one before it. */
const AUTOMATION_GROUP = "automation-group [.automation-group+&]:mt-page-section-gap";

/** What a group's count counts, said after its figure to a reader. */
const AUTOMATIONS_NOUN = "automations";

/** What each column of the list is headed, over the rows' words and each column of their metadata. */
const COLUMN_HEADS = {
  NAME: "Name",
  MANAGER: "Manager",
  MAKER: "Created by",
  NEXT: "Next run",
} as const;

/** An automation's or a run's metadata at its row's end, in a line of its own. */
export const AUTOMATION_ROW_META =
  "automation-row-meta inline-flex items-center gap-block-gap align-top";

/** How many rows the list's placeholder stands, enough to fill the top of its list. */
const SKELETON_ROWS = [
  { name: "38%", trigger: "52%" },
  { name: "46%", trigger: "40%" },
  { name: "30%", trigger: "58%" },
] as const;

/** How wide the placeholder Manager's and owner's names and next run stand, inside the columns the list keeps for them. */
const SKELETON_META = { MANAGER: "80px", OWNER: "64px", NEXT: "96px" } as const;

/** A row's clock tile, at an actor mark's row size (`ACTOR_SIZE.ROW`, `actor-ref.tsx`). */
const SKELETON_ROW_MARK = "20px";

/** The owner's and the Manager's marks at their inline size (`OWNER_MARK_SIZE.INLINE`, `ACTOR_SIZE.INLINE`: a 16px tile, picture, or face). */
const SKELETON_OWNER_MARK = "16px";

/** How wide the toolbar's two acts stand while the pages load: Create with an agent, and New automation. */
const SKELETON_ACTS = { AGENT: "150px", NEW: "140px" } as const;

/** The list's toolbar: its title, and its acts at its end. */
export function AutomationsToolbar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="automations-toolbar flex-none">
      <Toolbar title="Automations" titleReplayUnmasked actions={children} />
    </div>
  );
}

/** The toolbar's acts while the pages load: blocks where Create with an agent and New automation will stand. */
export function AutomationsActsSkeleton(): React.JSX.Element {
  return (
    <>
      <Skeleton kind={SKELETON_KIND.CONTROL} width={SKELETON_ACTS.AGENT} />
      <Skeleton kind={SKELETON_KIND.CONTROL} width={SKELETON_ACTS.NEW} />
    </>
  );
}

/** What a group's count is read as, one and many. */
const AUTOMATIONS_COUNTED = { one: "automation", many: AUTOMATIONS_NOUN } as const;

/** How a group folds, as the list keeps it: whether it stands folded, and what a press on its head asks. */
export interface AutomationGroupFold {
  readonly folded: boolean;
  readonly onToggle: () => void;
}

/**
 * One group of automations in a list, an owner's or Finished, under its
 * head where `headed`: a band on the well's tint, sticking to the top of the
 * page while its rows scroll beneath it, as Linear heads a list's groups
 * (`GROUP_LOOK.BAND`), led by the group's picture or glyph (`glyph`) in the
 * rows' leading column, a phone's rows' glyph or a wide row's avatar, so its
 * label stands where their titles do; folding its rows on a press as the
 * list keeps it (`fold`), and counting them while folded, and at rest on a
 * phone, as the sidebar counts its groups (`sidebarHead`).
 * Note that the list is a plain one, each row lit on its own as the Tasks
 * list's and the Inbox's are, so a row's hover, focus, and open menu draw
 * as theirs do. A list with no head, the placeholder's, is still a region
 * named by its owner, as a headed one is by its heading, so a reader moving
 * by landmark hears whose automations they are either way. A row made or
 * deleted stands or goes at once.
 */
export function AutomationGroupList({
  name,
  nameMasked = true,
  headed,
  glyph,
  fold,
  count,
  phone = false,
  children,
}: {
  name: string;
  /** Whether the name is a person's words, a workspace's name, kept masked in a screen recording. */
  nameMasked?: boolean;
  headed: boolean;
  /** What leads the head: the owner's picture, or Finished's glyph. */
  glyph?: ReactNode;
  /** How the group folds; left out, its rows always stand. */
  fold?: AutomationGroupFold | undefined;
  /** How many rows the group holds, which its head counts while folded, and at rest on a phone. */
  count?: number | undefined;
  /** Whether the room is a phone's, whose heads count their rows at rest. */
  phone?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const rows = <List label={name}>{children}</List>;

  return headed ? (
    <div className={AUTOMATION_GROUP}>
      <GroupHeader
        {...sidebarHead(
          fold === undefined
            ? undefined
            : {
                folded: fold.folded,
                onToggle: fold.onToggle,
                count: count ?? 0,
                noun: AUTOMATIONS_COUNTED,
              },
          phone,
        )}
        heading={GROUP_HEADING.H2}
        look={GROUP_LOOK.BAND}
        head={GROUP_HEAD.STICKS}
        rowLead={phone ? GROUP_ROW_LEAD.GLYPH : GROUP_ROW_LEAD.AVATAR}
        glyph={glyph}
        label={nameMasked ? <ReplayMask>{name}</ReplayMask> : name}
      >
        {rows}
      </GroupHeader>
    </div>
  ) : (
    <section className={AUTOMATION_GROUP} aria-label={name}>
      {rows}
    </section>
  );
}

/** A row's metadata at its end: the Manager its runs land on, where the list names one, its owner's column, then its next run's, set against the switch. */
export function AutomationRowMeta({
  lead,
  manager,
  owner,
  next,
}: {
  /** What is read before the columns and drawn nowhere: the working word where a run is. */
  lead?: ReactNode;
  /** The Manager's column: its face and name, or nothing in it for an automation that hands its runs to none; left out, a list that names no Manager draws no column. */
  manager?: ReactNode;
  owner: ReactNode;
  next: ReactNode;
}): React.JSX.Element {
  return (
    <span className={AUTOMATION_ROW_META}>
      {lead}
      {manager === undefined ? null : (
        <span className="automation-row-manager inline-flex w-automation-manager flex-none items-center gap-item-gap overflow-hidden whitespace-nowrap">
          {manager}
        </span>
      )}
      {owner}
      <span className="automation-row-next inline-flex w-automation-next flex-none items-center justify-end gap-item-gap overflow-hidden">
        {next}
      </span>
    </span>
  );
}

/**
 * The heads over a wide list's columns: Name over the rows' words, then
 * Manager where the list names one, Created by, and Next run, each over its
 * column, room kept for the rows' tile, switch, and ⋯ (`more`) as they draw
 * them. A narrow room's rows have no columns, so it draws none.
 */
export function AutomationListHeads({
  managers,
  more,
}: {
  /** Whether the list names the Manager its rows' runs land on, in a column of its own. */
  managers: boolean;
  more: boolean;
}): React.JSX.Element {
  // Note that the heads stand in a box of their own, as each owner's list does, so they keep its insets rather than a page's bleed for a list standing in it bare.
  return (
    <div className="automation-list-heads">
      <ListHeads
        title={COLUMN_HEADS.NAME}
        lead={LIST_HEADS_LEAD.AVATAR}
        acts={LIST_HEADS_ACTS.SWITCH}
        more={more}
        meta={
          <AutomationRowMeta
            manager={managers ? <ListHead>{COLUMN_HEADS.MANAGER}</ListHead> : undefined}
            owner={
              <AutomationOwnerFrame mark={null} name={<ListHead>{COLUMN_HEADS.MAKER}</ListHead>} />
            }
            next={<ListHead>{COLUMN_HEADS.NEXT}</ListHead>}
          />
        }
      />
    </div>
  );
}

/** Who owns an automation, in its column: their mark and their name. */
export function AutomationOwnerFrame({
  owner,
  mark,
  name,
}: {
  owner?: string | undefined;
  mark: ReactNode;
  name: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className="automation-owner inline-flex w-automation-owner flex-none items-center gap-item-gap overflow-hidden whitespace-nowrap"
      data-owner={owner}
    >
      {mark}
      {name}
    </span>
  );
}

/**
 * The list while it is first read, in its own list and rows: each row's
 * clock tile, its name over what fires it, its Manager, its owner, and its
 * next run in their columns, and its switch, a narrow room's rows naming neither and ending in
 * a chevron, as a phone's rows do, so the list lands where the blocks stood.
 * Note that it stands no heads over its columns, as it stands no owner's
 * heading, so it says nothing but that the list is being read. The rows
 * open nothing.
 */
export function AutomationListSkeleton({ narrow }: { narrow: boolean }): React.JSX.Element {
  return (
    <AutomationGroupList name="Automations" headed={false}>
      {SKELETON_ROWS.map(({ name, trigger }) => (
        <ListRow
          key={name}
          leading={<Skeleton kind={SKELETON_KIND.CIRCLE} width={SKELETON_ROW_MARK} />}
          title={<Skeleton width={name} />}
          description={<Skeleton width={trigger} />}
          meta={
            narrow ? undefined : (
              <AutomationRowMeta
                manager={
                  <>
                    <Skeleton kind={SKELETON_KIND.CIRCLE} width={SKELETON_OWNER_MARK} />
                    <Skeleton width={SKELETON_META.MANAGER} />
                  </>
                }
                owner={
                  <AutomationOwnerFrame
                    mark={<Skeleton kind={SKELETON_KIND.CIRCLE} width={SKELETON_OWNER_MARK} />}
                    name={<Skeleton width={SKELETON_META.OWNER} />}
                  />
                }
                next={<Skeleton width={SKELETON_META.NEXT} />}
              />
            )
          }
          actions={
            narrow ? undefined : (
              <SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SWITCH} />
            )
          }
          chevron={narrow}
        />
      ))}
    </AutomationGroupList>
  );
}
