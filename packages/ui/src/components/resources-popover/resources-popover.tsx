import { useRef } from "react";
import { cssCustomProperties } from "../../css.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../shadcn/table.js";
import { SORT_DIRECTION, type SortDirection } from "../../sort-direction.js";
import { useClipped } from "../../use-clipped.js";
import type { ChipPopoverFact } from "../chip-popover/chip-popover.js";
import { COPY_LOOK, CopyButton } from "../copy-button/copy-button.js";
import { SortHeading } from "../data-table/sort-heading.js";
import { Fact, Facts } from "../facts/facts.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { PopoverIconButton } from "../popover-icon-button/popover-icon-button.js";

/**
 * resources-popover.tsx -- a glyph button that hangs what the app spends of the machine under it: its totals as facts, then each of its processes as a row of name, CPU, and memory, sorted by the column chosen.
 *
 * The button wears the memory glyph and says its name on a rest. A press
 * hangs a card from it headed by its title, a Copy of the whole list at the
 * head's end, its totals under it (`Facts`, as a cloud sandbox's CPU and
 * Memory stand), and then the table: a row per process, a child indented
 * under the process that started it, so a shell's commands and an agent's
 * tools stand under what ran them. A heading's press sorts by its column,
 * a name from A, a figure from the largest, the arrow on the heading chosen.
 * The rows arrive ordered and their figures said; the owner sorts them and
 * says what each is, and draws them while the card stands. The card hangs
 * on the window's layer (`PopoverIconButton`), so a narrow column the
 * button stands in, as the sidebar's title-bar row is, never cuts it.
 *
 * Its title, headings, and totals are the app's own words and figures, which
 * a screen recording shows as they read; a process's name stays masked.
 */

/** The columns a reader sorts the rows by. */
export const RESOURCE_SORT = {
  NAME: "name",
  CPU: "cpu",
  MEMORY: "memory",
} as const;

export type ResourceSort = (typeof RESOURCE_SORT)[keyof typeof RESOURCE_SORT];

/** The way each column sorts: a name from A, a figure from the largest. */
const SORT_WAY: Record<ResourceSort, SortDirection> = {
  [RESOURCE_SORT.NAME]: SORT_DIRECTION.ASCENDING,
  [RESOURCE_SORT.CPU]: SORT_DIRECTION.DESCENDING,
  [RESOURCE_SORT.MEMORY]: SORT_DIRECTION.DESCENDING,
};

/** One process as the table draws it: its name, how deep it stands under the processes that started it, and its figures as said. */
export interface ResourceRow {
  readonly key: string;
  readonly name: string;
  /** 0 for a process at the top, 1 for its child, and so on. */
  readonly depth: number;
  readonly cpu: string;
  readonly memory: string;
}

/** What the table's headings say. */
export interface ResourceHeadings {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
}

/** The card the button hangs, as a popover card stands: its sections apart in one column at the caption's type, scrolling within the room its side of the button leaves. */
const CARD =
  "ui-resources-card flex min-h-0 w-popover-wide flex-col focus-visible:outline-none gap-block-gap overflow-y-auto overscroll-contain p-card-inset-snug text-caption";

/** The card's head: its title, and the Copy at its end, pulled out so its glyph lines up with the content's edge. */
const HEAD = "-mr-2 flex items-center justify-between gap-control-gap";

const TITLE = "m-0 text-section font-section";

/** A cell, tighter than a page's table's, its first and last flush with the card's inset. */
const CELL = "px-control-gap py-tight-gap first:ps-0 last:pe-0";

/** A figure's cell: its end aligned, in figures of one width. */
const FIGURE = `${CELL} text-end tabular-nums`;

/** The name's cell takes the room the figures leave it, a long name cut at its edge (`resources-popover.css` fades it). */
const NAME = `${CELL} w-full max-w-0 overflow-hidden`;

/** A name pushed in by its depth, a nested list row's step a level (`--ui-list-row-depth`). */
const NESTED = "ui-resources-name block overflow-hidden ps-list-row-nest";

/** A process's name, marked while its cell cuts it short, so it fades out at its end rather than stopping on a cut letter. */
function ResourceName({ name, depth }: { name: string; depth: number }): React.JSX.Element {
  const [measured, clipped] = useClipped(name);
  return (
    <span
      ref={measured}
      className={NESTED}
      data-overflow={clipped ? "true" : undefined}
      style={cssCustomProperties({ "--ui-list-row-depth": depth })}
    >
      {name}
    </span>
  );
}

/** A heading's cell, the order it is sorted in told to a reader. */
function Heading({
  column,
  sort,
  onSort,
  figure,
  children,
}: {
  column: ResourceSort;
  sort: ResourceSort;
  onSort: (sort: ResourceSort) => void;
  figure: boolean;
  children: string;
}): React.JSX.Element {
  const direction = column === sort ? SORT_WAY[column] : undefined;
  return (
    <TableHead className={figure ? FIGURE : NAME} aria-sort={direction}>
      <SortHeading direction={direction} onPress={() => onSort(column)}>
        {children}
      </SortHeading>
    </TableHead>
  );
}

/** The processes' table under its headings. */
function ResourcesTable({
  label,
  headings,
  sort,
  onSort,
  rows,
}: {
  label: string;
  headings: ResourceHeadings;
  sort: ResourceSort;
  onSort: (sort: ResourceSort) => void;
  rows: readonly ResourceRow[];
}): React.JSX.Element {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <ReplayUnmask>
          <TableRow>
            <Heading column={RESOURCE_SORT.NAME} sort={sort} onSort={onSort} figure={false}>
              {headings.name}
            </Heading>
            <Heading column={RESOURCE_SORT.CPU} sort={sort} onSort={onSort} figure>
              {headings.cpu}
            </Heading>
            <Heading column={RESOURCE_SORT.MEMORY} sort={sort} onSort={onSort} figure>
              {headings.memory}
            </Heading>
          </TableRow>
        </ReplayUnmask>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} className="border-0">
            <TableCell className={NAME}>
              <ResourceName name={row.name} depth={row.depth} />
            </TableCell>
            <TableCell className={FIGURE}>{row.cpu}</TableCell>
            <TableCell className={FIGURE}>{row.memory}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ResourcesPopover({
  label,
  open,
  onOpenChange,
  facts,
  headings,
  sort,
  onSort,
  rows,
  empty,
  copy,
}: {
  /** What the button, its card, and its table are called: "Resources". */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The totals over the table: CPU and Memory. */
  facts: readonly ChipPopoverFact[];
  headings: ResourceHeadings;
  sort: ResourceSort;
  onSort: (sort: ResourceSort) => void;
  /** The rows in the order chosen; none until the first read lands. */
  rows: readonly ResourceRow[] | undefined;
  /** Said in the table's place while there are no rows. */
  empty: string;
  /** The list as words its Copy puts on the clipboard, what it is called after "Copy", and the caller's act that copies. */
  copy: { text: string; what: string; run: (text: string) => Promise<void> };
}): React.JSX.Element {
  // Note that the card itself takes the focus as it opens, because a press that only means to look should not light its Copy.
  const card = useRef<HTMLDivElement>(null);
  return (
    <PopoverIconButton
      icon={<GLYPH.RAM />}
      label={label}
      title={label}
      hint={label}
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      initialFocus={card}
    >
      <div ref={card} tabIndex={-1} className={CARD}>
        <div className={HEAD}>
          <ReplayUnmask>
            <h2 className={TITLE}>{label}</h2>
          </ReplayUnmask>
          <CopyButton
            look={COPY_LOOK.ICON}
            text={copy.text}
            what={copy.what}
            copy={copy.run}
            disabled={rows === undefined || rows.length === 0}
          />
        </div>
        <ReplayUnmask>
          <Facts>
            {facts.map((fact) => (
              <Fact key={fact.label} icon={fact.icon} label={fact.label}>
                {fact.value}
              </Fact>
            ))}
          </Facts>
        </ReplayUnmask>
        {rows === undefined || rows.length === 0 ? (
          <ReplayUnmask>
            <NoteLine look={NOTE_LINE_LOOK.LIST}>{empty}</NoteLine>
          </ReplayUnmask>
        ) : (
          <ResourcesTable
            label={label}
            headings={headings}
            sort={sort}
            onSort={onSort}
            rows={rows}
          />
        )}
      </div>
    </PopoverIconButton>
  );
}
