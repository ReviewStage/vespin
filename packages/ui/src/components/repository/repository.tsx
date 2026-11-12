import { NO_REPOSITORY, repositoryParts } from "@repo/features/task-list-model";
import { repositoryOwnerPictureUrl } from "@repo/features/tasks-model";
import { Fragment, useRef, useState } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { FolderXIcon, GLYPH } from "../../icons/icons.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar, type AvatarSize } from "../avatar/avatar.js";
import { Badge } from "../badge/badge.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { OneLine } from "../one-line/one-line.js";
import { SCROLL_FADE, SCROLL_SIZE, ScrollArea } from "../scroll-area/scroll-area.js";
import type { MenuRow } from "../searchable-menu/searchable-menu.js";
import { Tooltip } from "../tooltip/hint.js";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
} from "../virtual-rows/virtual-rows.js";

/**
 * repository.tsx -- a GitHub repository as every surface draws it: its owner's picture, then its name.
 *
 * The owner's picture, an organization's logo or a person's avatar, is how
 * GitHub itself and every devtool beside it tells repositories apart at a
 * glance, so a repository's name is led by it wherever one is named: the
 * sidebar's and the Tasks page's headers and rows, a board's card, the
 * repository chip and the rows of its menu, a task's card, Settings. The
 * words are the repository's name alone, unless another repository the same
 * view names shares it, where they are `owner/name` (`repositoryLabel`); the
 * hover names it whole, through the tooltip or the card of whatever holds it.
 * Where one repository is being set, the composer's chip and the task's
 * path, the words are its whole `owner/name`, the picture before them. No
 * repository is one state, a crossed-out folder and "No repository", and a
 * picture that cannot be drawn is the repository's own glyph.
 *
 * Prose is the exception and keeps `owner/name` as plain words: a sentence,
 * a pull request's key, a file's path, an admin table's cell.
 */

/** The mark beside a repository the developer's own GitHub token reaches rather than the App. */
const TOKEN_LABEL = "Token";

/** How tall a repository's line stands, in pixels: the theme's `ui-24`, which `h-ui-24` draws it at. */
const LINE_PX = 24;

/** The marks a repository's row wears after its owner: whether the developer's own token reaches it. */
export interface RepositoryRowMarks {
  readonly token?: boolean | undefined;
}

/**
 * A repository's owner's picture, a tile of `Avatar`, edged, blank until it
 * has loaded, sized by the glyph slot it stands in. Where there is no
 * picture to draw, the repository's own glyph stands in its place: where it
 * fails to load, and in a fixture run, whose frames ask nothing of the
 * network. A picture that fails is remembered by its address for as long as
 * this one stands, so another repository gets its own chance. It loads
 * lazily, so a menu of a thousand repositories asks for the few rows in
 * sight rather than every row it holds.
 */
export function RepositoryPicture({
  repository,
  pictures,
  size = AVATAR_SIZE.INLINE,
}: {
  /** The repository, `owner/name`. */
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  /** The tile's size, the glyph slot's it stands in. */
  size?: AvatarSize;
}): React.ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const url = pictures ? repositoryOwnerPictureUrl(repository) : undefined;

  if (url === undefined || url === failedUrl) return <GLYPH.REPOSITORY />;

  return (
    <Avatar
      name=""
      src={url}
      size={size}
      shape={AVATAR_SHAPE.TILE}
      decorative
      edged
      blank
      lazy
      onFail={() => setFailedUrl(url)}
    />
  );
}

/** The mark of a place that names no repository, a crossed-out folder. */
export function NoRepositoryGlyph(): React.JSX.Element {
  return <FolderXIcon />;
}

/**
 * A repository named in a line: its owner's picture in a glyph's slot, then
 * its words, cut short where the line ends, the whole `owner/name` hung over
 * them on hover; or, for none, the crossed-out folder and "No repository".
 */
export function RepositoryName({
  repository,
  label,
  pictures,
}: {
  /** The repository, `owner/name`, or none. */
  repository: string | null;
  /** The words the view says for it (`repositoryLabel`): its name alone where none is given. */
  label?: string | undefined;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const words = repository === null ? NO_REPOSITORY : (label ?? repositoryParts(repository).name);

  return (
    <span className="ui-repository-name inline-flex min-w-0 items-center gap-icon-gap">
      <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.MEDIUM}>
        {repository === null ? (
          <NoRepositoryGlyph />
        ) : (
          <RepositoryPicture repository={repository} pictures={pictures} />
        )}
      </GlyphSlot>
      <OneLine
        hint={
          repository === null
            ? undefined
            : (line, clipped) => (
                <Tooltip label={clipped || words !== repository ? repository : undefined}>
                  {line}
                </Tooltip>
              )
        }
      >
        {words}
      </OneLine>
    </span>
  );
}

/** A repository's card: its owner's picture and its name, and its owner under the name. */
export function RepositoryCard({
  repository,
  pictures,
}: {
  /** The repository, `owner/name`. */
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const { owner, name } = repositoryParts(repository);

  return (
    <HoverCard data-repository-card="">
      <HoverCardHead
        glyph={
          <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.GLYPH} />
        }
        name={name}
        sub={owner}
      />
    </HoverCard>
  );
}

/**
 * A repository's row in a searched menu or a picker: its owner's picture,
 * its name, its owner muted after it, since the owner is the part rows most
 * often share and a narrow menu cuts the end of a row, and after the owner
 * the Token mark, where the developer's own GitHub token reaches it rather
 * than the App; found by its whole `owner/name` all the same.
 */
export function repositoryMenuRow(
  repository: string,
  pictures: boolean,
  marks: RepositoryRowMarks = {},
): MenuRow {
  const { owner, name } = repositoryParts(repository);
  const badges = marks.token === true ? [TOKEN_LABEL] : [];

  return {
    id: repository,
    label: name,
    detail:
      badges.length === 0 ? (
        owner
      ) : (
        <>
          {owner}
          {badges.map((badge) => (
            <Fragment key={badge}>
              {" "}
              <Badge>{badge}</Badge>
            </Fragment>
          ))}
        </>
      ),
    terms: [repository],
    icon: <RepositoryPicture repository={repository} pictures={pictures} />,
  };
}

/** One repository the list names: `owner/name`, and whether the developer's own token reaches it rather than the App. */
export interface RepositoryLineEntry {
  readonly repository: string;
  readonly token?: boolean | undefined;
}

/** One repository's line: its name as the sidebar draws it, whole, and its Token mark where it has one. */
function RepositoryLine({
  entry,
  pictures,
  place,
}: {
  entry: RepositoryLineEntry;
  pictures: boolean;
  place: VirtualRowPlace;
}): React.JSX.Element {
  return (
    <li
      {...place}
      className="ui-repository-line flex h-ui-24 min-w-0 items-center gap-icon-gap text-body"
    >
      <RepositoryName repository={entry.repository} label={entry.repository} pictures={pictures} />
      {entry.token === true ? <Badge>{TOKEN_LABEL}</Badge> : null}
    </li>
  );
}

/**
 * The repositories a workspace reaches, one line each, in a short list that
 * scrolls: each line a repository as the sidebar names one
 * (`RepositoryName`), its owner's picture and then its whole `owner/name`,
 * since the list mixes owners, followed by the Token mark where the
 * developer's own GitHub token reaches it rather than the App, as the
 * picker's rows wear it (`repositoryMenuRow`). The list stands about six
 * lines tall, half of a seventh showing where there are more, and scrolls
 * the rest in its own `ScrollArea`, its cut edges fading; only the lines
 * near its view are drawn (`VirtualRows`), so an organization's thousands
 * stay quick. It is a list to a reader, named by `label`, each line an item
 * that says where it stands among them. Setup's GitHub step and Settings ›
 * Workspace's GitHub accounts both draw it.
 */
export function RepositoryLines({
  repositories,
  label,
  pictures,
}: {
  repositories: readonly RepositoryLineEntry[];
  /** What the list is called, to a reader ("acme's repositories"). */
  label: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null);
  // Note that a line is keyed by its name as spelled, because two names that differ only in case are two lines.
  const keys = repositories.map(({ repository }) => repository);

  return (
    <div className="ui-repository-lines flex min-w-0 max-h-repository-lines flex-col">
      <ScrollArea ref={scroller} size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
        <div className="min-w-0">
          <VirtualRows
            scroller={scroller}
            keys={keys}
            estimate={LINE_PX}
            anchor={VIRTUAL_ROWS_ANCHOR.START}
            listItems
            aria-label={label}
          >
            {(index, place) => {
              const entry = repositories[index];

              return entry === undefined ? null : (
                <RepositoryLine entry={entry} pictures={pictures} place={place} />
              );
            }}
          </VirtualRows>
        </div>
      </ScrollArea>
    </div>
  );
}
