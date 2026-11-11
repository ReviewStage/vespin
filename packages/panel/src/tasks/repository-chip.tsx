import type { GitHubRepository } from "@repo/features";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { NO_REPOSITORY } from "@repo/features/task-list-model";
import { repositoryFailureNote } from "@repo/features/tasks-model";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { countWords, orList, readingWords } from "@repo/features/words";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import {
  AVATAR_SIZE,
  CHIP_LOOK,
  Chip,
  type ChipLook,
  ChipName,
  type ChipWidth,
  ErrorState,
  MARK_PROVIDER,
  MenuNoteRow,
  type MenuRow,
  NoRepositoryGlyph,
  POPOVER_ALIGN,
  type PopoverAlign,
  ProviderMark,
  RepositoryCard,
  RepositoryPicture,
  repositoryMenuRow,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
  Spinner,
  Tooltip,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { failureShown } from "../failure-report.js";
import {
  repositoryListsQuery,
  repositoryListsRetryMutation,
  repositoryScope,
  workspaceMembersQuery,
} from "../live-reads.js";
import { useOpenSettings } from "../open-settings.js";

/**
 * repository-chip.tsx -- the chip that names a task's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a task about to start, the way a
 * branch or model chip is: the owner's picture and `owner/name`, or the
 * GitHub mark and the pick it is waiting on. In the open plan the same
 * menu drops from the first crumb of the task's path over its title
 * (`task-standing.tsx`, through `useRepositoryMenu`), reading `Choose a
 * repository` while the task has none and the repository once the task
 * names one; ⌘K's Change repository opens its menu from there, and a task
 * row's menu holds the same list as Change repository's submenu
 * (`RepositoryMenuPanel`). Its menu is the shared searchable one: a search over every
 * repository the GitHub connected to the workspace reaches, the
 * repositories the account's tasks were about lately first and the rest as
 * GitHub last saw them change, each under its owner's picture, one the
 * developer's own GitHub token reaches marked Token. Nothing the
 * workspace's GitHub does not reach is offered, so a task never starts on
 * a repository its workspace cannot work in; a pick the read finds out of
 * reach is handed back, and with nothing to offer the chip reads No
 * repository, which a task can start with. An opener that may stand on
 * no repository, as New task and an automation's editor may, is offered No repository
 * pinned under the list, which lets the pick go. With no
 * GitHub connected to the workspace, one GitHub removed or suspended, or
 * one installed that reaches no repository, the list's place holds one
 * GitHub row, as a disconnected server's row in the Integrations menu is
 * drawn (`MenuNoteRow`): an owner or an admin is offered Connect, Reconnect,
 * or Choose repositories at its end, each opening the workspace's GitHub
 * repositories in Settings, the one place they are set, and a member is
 * told there which owners and admins, by name, to ask. Every other list
 * ends the same way: an owner or an admin is offered Configure repositories
 * in Settings pinned last under it, and a member is told on its last line
 * whom to ask to configure them. The list is held by the host while the chip stands, drawn at once from its
 * last answer, and asked again whenever a window comes forward, so a
 * developer back from connecting GitHub in the browser sees the change on
 * the next opening; nothing polls. The menu
 * is placed as a Settings picker's is, below the chip or above it where the
 * window leaves more room there, its list capped to that room. A one-pick
 * menu closes on a choice, and every menu on Escape and on focus leaving
 * it; Escape stops there, so it closes the menu and not the panel behind it.
 */

/** What the chip's menu offers, read from the account's tasks and the service. */
export interface RepositoryChooser {
  /** The repositories the account's tasks were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Whether those tasks are still being read, so the newest's repository, a card's default, is not yet known; never where left out. */
  reading?: boolean | undefined;
  /** Opens a page of GitHub's in the browser, such as a repository's own. */
  openGitHub: (url: string) => void;
  /** Whether a repository is drawn with its owner's picture: not in a fixture run (`RepositoryPicture`). */
  pictures: boolean;
  /** The workspace the list is for, where one is chosen, whose repositories the host holds for the chip (`LIVE_READ.REPOSITORY_LISTS`); every workspace's where none is. */
  scope?: string | undefined;
  /** Whether the account manages that workspace, so can connect its GitHub; a member is told to ask. */
  manages: boolean;
  /**
   * Whether the workspace has a GitHub connected, as its row last said: a read
   * that then finds none installed means GitHub removed or suspended it, which
   * the row offers Reconnect for rather than Connect, whether or not the row
   * has heard yet.
   */
  connected?: boolean | undefined;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  /** A form row's value, or the plan's chip row, as a Settings picker's chip is drawn. */
  FIELD: "field",
  /** A press among a row's outlined buttons, its words the press's own, as setup's Add repositories. */
  ACTION: "action",
} as const;

type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's look in each place: the composer's pill, a form row's field, or an outlined button's. */
const PLACE_LOOK = {
  [CHIP_PLACE.COMPOSER]: CHIP_LOOK.PILL,
  [CHIP_PLACE.FIELD]: CHIP_LOOK.FIELD,
  [CHIP_PLACE.ACTION]: CHIP_LOOK.OUTLINE,
} as const satisfies Record<ChipPlace, ChipLook>;

/** The chip's words while it waits on a pick. */
export const CHOOSE_LABEL = "Choose a repository";

/** The chip's words while what its default is read from, the tasks or the repositories, is still being read, which ask nothing yet. */
const READING_LABEL = "Repository";

/** The id of the row pinned under the list that chooses no repository. */
const NONE_ROW = "none";

/** The id of the row pinned last under the list that opens the workspace's GitHub repositories in Settings. */
const SETTINGS_ROW = "settings";

/** What that row says, to an owner or an admin. */
const SETTINGS_LABEL = "Configure repositories in Settings";

/** What a member asks the owners and admins to do in its place, finishing "Ask … to". */
const SETTINGS_ASK = "configure repositories";

/** What the menu says where the search matches no repository. */
const NO_MATCH = "No repositories match";

/** What the row in the list's place names, where nothing can be picked. */
const GITHUB_LABEL = "GitHub";

/**
 * Each way the list can stand empty for want of GitHub: the press an owner
 * or an admin mends it with, and what a member asks them to do, finishing
 * "Ask … to".
 */
const DEAD_END = {
  NOT_CONNECTED: { action: "Connect", ask: "connect" },
  LAPSED: { action: "Reconnect", ask: "reconnect" },
  NONE_REACHED: { action: "Choose repositories", ask: "choose repositories" },
} as const;

type DeadEnd = (typeof DEAD_END)[keyof typeof DEAD_END];

/** How many owners and admins a member's row names before it counts the rest. */
const NAMED_OWNERS = 3;

/** Who a member asks when none of the workspace's owners and admins is named. */
export const ANY_OWNER = "an owner or admin";

/** The words counting the owners and admins past those named: "2 others". */
export function otherOwnersWords(rest: number): string {
  return countWords(rest, { one: "other", many: "others" });
}

/**
 * Who a member asks to mend a workspace's GitHub: its owners and admins, the
 * first few named and the rest counted, read while the asker stands; none
 * named until the read answers, or if it never does, since a name is only
 * ever a help.
 */
export function useOwnersToAsk(workspaceId: string | undefined): {
  readonly named: readonly WorkspaceMember[];
  readonly rest: number;
} {
  const members = useQuery(workspaceMembersQuery(workspaceId)).data?.members;
  const owners = (members ?? []).filter(
    (each) => each.role === WORKSPACE_ROLE.OWNER || each.role === WORKSPACE_ROLE.ADMIN,
  );
  const named = owners.slice(0, NAMED_OWNERS);
  return { named, rest: owners.length - named.length };
}

/** Whom a member asks, as words: the owners and admins named by `useOwnersToAsk`, or any of them while none is. */
function useWhomToAsk(workspaceId: string | undefined): string {
  const { named, rest } = useOwnersToAsk(workspaceId);
  const others = rest > 0 ? [otherOwnersWords(rest)] : [];
  return named.length === 0 ? ANY_OWNER : orList([...named.map((each) => each.name), ...others]);
}

/** A member's way out of a dead end: the GitHub row, ending in whom to ask (`useWhomToAsk`), who alone can mend it. */
function AskOwnersRow({
  workspaceId,
  ask,
}: {
  workspaceId: string | undefined;
  ask: DeadEnd["ask"];
}): React.JSX.Element {
  const whom = useWhomToAsk(workspaceId);
  return (
    <MenuNoteRow
      glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
      label={GITHUB_LABEL}
      end={{ words: `Ask ${whom} to ${ask}` }}
    />
  );
}

/** Whether the read's repositories hold one, as GitHub spells it or not. */
function listedIn(reached: readonly GitHubRepository[], repository: string): boolean {
  const wanted = repository.toLowerCase();
  return reached.some((each) => each.fullName.toLowerCase() === wanted);
}

/**
 * The menu's rows: the recent repositories first, then every other the App
 * reaches as the service ordered them, most recently updated first, each
 * once, every one under its owner's picture whether private or not. Once
 * the read has answered, a recent repository it does not list is left out,
 * because a plan started on it would be refused. A row names the repository
 * first and its owner muted after it, since the owner is the part rows most
 * often share, and a narrow menu cuts the end of a row; it is found by its
 * whole `owner/name` all the same.
 */
function repositoryRows(
  recent: readonly string[],
  reached: readonly GitHubRepository[] | undefined,
  pictures: boolean,
): MenuRow[] {
  const names =
    reached === undefined ? [...recent] : recent.filter((each) => listedIn(reached, each));
  for (const each of reached ?? []) {
    if (!names.includes(each.fullName)) names.push(each.fullName);
  }
  const onToken = new Set(
    (reached ?? [])
      .filter((each) => each.access === GITHUB_ACCESS.TOKEN)
      .map((each) => each.fullName),
  );
  return names.map((fullName) =>
    repositoryMenuRow(fullName, pictures, { token: onToken.has(fullName) }),
  );
}

/** Whether two `owner/name`s name one repository, as GitHub spells it or not. */
function sameName(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

/** Where a repository's menu stands, whatever it lists; closing hands focus back to its opener, as a native menu returns it to its trigger. */
function useMenuPlace() {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const room = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    open,
    drawn,
    menuId,
    room,
    ask: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    },
    press: (from: HTMLElement) => {
      opener.current = from;
      setOpen(!open);
    },
    close: () => {
      setOpen(false);
      opener.current?.focus();
    },
    leave: (left: EventTarget | null) => {
      if (!(left instanceof Node && room.current?.contains(left))) setOpen(false);
    },
  };
}

type MenuPlace = ReturnType<typeof useMenuPlace>;

type SearchableMenuProps = React.ComponentProps<typeof SearchableMenu>;

/** What a repository's menu lists and what a pick does, whichever layer it stands in. */
type ListedMenu = Pick<
  SearchableMenuProps,
  "rows" | "value" | "checked" | "note" | "onPick" | "foot" | "lastLine"
>;

/** The searched menu's props over the rows it lists. Note that every row names a repository and its owner, so each stays masked, and the note, which can name the workspace, is left unmarked. */
function repositoryMenuProps(menu: ListedMenu, id: string) {
  return {
    ...menu,
    id,
    label: menu.checked === undefined ? "Repository" : "Repositories",
    placeholder: "Search repositories",
    replayUnmasked: true,
    rows: menu.rows.map((row) => ({ ...row, replayMasked: true })),
    noMatch: NO_MATCH,
  };
}

/** The searched menu a repository's opener drops, hung from the opener's room. */
function repositoryMenu(
  place: MenuPlace,
  menu: ListedMenu & { align: PopoverAlign },
): React.ReactNode {
  return place.drawn.mounted ? (
    <SearchableMenu
      {...repositoryMenuProps(menu, place.menuId)}
      align={menu.align}
      leaving={place.drawn.leaving}
      ref={place.drawn.ref}
      onClose={place.close}
      onLeave={place.leave}
    />
  ) : null;
}

/** The rows of `rows` whose repository is among `picked`, by the id each row spells it with, which a pick may spell in another case. */
function checkedAmong(rows: readonly MenuRow[], picked: readonly string[]): ReadonlySet<string> {
  return new Set(
    rows.filter((row) => picked.some((each) => sameName(each, row.id))).map((row) => row.id),
  );
}

/** The owner's picture of the repository picked, at a chip's glyph size. */
function firstPicture(repository: string, pictures: boolean): React.JSX.Element {
  return <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.GLYPH} />;
}

/** What the repository's menu is handed, whatever opens it: the chip, or the plan's repository crumb. */
interface RepositoryMenuProps {
  /** The repository named now, `owner/name`, or null while none is. */
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  /** Lets the pick go, offered as No repository pinned under the list, where the opener may stand on none, as a new task or an automation's runs may; a null value then reads No repository. */
  onClear?: (() => void) | undefined;
  /** Lets go of a pick the read finds the workspace's GitHub does not reach, where the pick is the opener's own to drop. */
  onUnreached?: (() => void) | undefined;
  /** Whether a null value is a default still waiting on the read rather than No repository picked, so it reads as waiting while the read could still name one. */
  pending?: boolean | undefined;
  /** Hears the repositories each successful read lists, `owner/name`. */
  onListed?: ((repositories: readonly string[]) => void) | undefined;
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  /** Hears each ask the menu opened for, so the asker can let it go. */
  onAsked?: ((request: number) => void) | undefined;
  /** The edge of its room the menu hangs from, the trailing one where none is named. */
  align?: PopoverAlign | undefined;
  /** The repositories the menu leaves out, in any case, as an opener that adds one leaves out those it holds; none where left out. */
  omit?: readonly string[] | undefined;
}

/**
 * The repository's menu as its opener draws it: whether it stands open, the
 * opener's words and mark, the card it hangs while shut, the press that
 * opens and shuts it from the element pressed, the room the menu hangs in,
 * which the opener's box holds as the menu's anchor, and the menu itself,
 * drawn in that room.
 */
export interface RepositoryMenu {
  readonly open: boolean;
  readonly menuId: string;
  /** The opener's words: the repository, or the pick it waits on. */
  readonly label: string;
  /** What the opener's hint names: the repository, whole; none while none is. */
  readonly hint: string | undefined;
  /** The owner's picture, or the repository's glyph while none is named. */
  readonly glyph: React.JSX.Element;
  /** The repository's card, none while none is named or the menu stands open. */
  readonly card: React.ReactNode;
  readonly press: (opener: HTMLElement) => void;
  readonly room: React.RefObject<HTMLDivElement | null>;
  readonly menu: React.ReactNode;
}

/** What a repository's opener names and its menu lists, read once for whichever layer the menu stands in. */
interface RepositoryListing {
  readonly label: string;
  readonly hint: string | undefined;
  readonly glyph: React.JSX.Element;
  readonly menu: ListedMenu;
}

/**
 * The repository's list as the chip's menu always read it, its opener's
 * words and mark beside it; a pick, and a press that leaves for Settings,
 * runs through `choose`, which closes the menu first.
 */
function useRepositoryListing(
  props: RepositoryMenuProps,
  choose: (pick: () => void) => void,
): RepositoryListing {
  const { chooser, onUnreached, onListed, onClear, value } = props;
  const openSettings = useOpenSettings();
  // Note that the host asks the list again as a window comes forward, which is how a developer returns from installing the App in the browser.
  const scope = chooser.scope ?? EVERY_WORKSPACE;
  const list = useQuery(repositoryListsQuery(scope));
  const retry = useMutation(repositoryListsRetryMutation());

  const listed = list.data;
  const failure = list.isError ? TASK_CALL_FAILURE.UNANSWERED : undefined;
  // A pick the read does not list is handed back, so nothing out of reach stands chosen.
  const unreached = value !== null && listed !== undefined && !listedIn(listed.repositories, value);
  useEffect(() => {
    if (unreached) onUnreached?.();
  }, [unreached, onUnreached]);
  useEffect(() => {
    if (listed !== undefined) onListed?.(listed.repositories.map((each) => each.fullName));
  }, [listed, onListed]);
  // A GitHub not connected, or reaching nothing, is mended at the workspace's GitHub row.
  const workspaceGitHub: SettingsLink = {
    page: SETTINGS_VIEW.WORKSPACE,
    section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
    ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
  };
  const omitted = new Set((props.omit ?? []).map((each) => each.toLowerCase()));
  const rows = repositoryRows(chooser.recent, listed?.repositories, chooser.pictures).filter(
    (row) => !omitted.has(row.id.toLowerCase()),
  );
  // Note that no repository is a choice of its own where the opener lets one go, so it is not said as a pick still owed.
  const nothingReached = rows.length === 0 && listed !== undefined;
  const none = nothingReached || (onClear !== undefined && props.pending !== true);
  const label =
    value ??
    (none
      ? NO_REPOSITORY
      : chooser.reading === true || props.pending === true
        ? READING_LABEL
        : CHOOSE_LABEL);
  // Note that a member is told whom to ask, so only a member reads the workspace's people.
  const whom = useWhomToAsk(chooser.manages ? undefined : chooser.scope);
  const configure = () => choose(() => openSettings(workspaceGitHub));
  // A list with nothing to pick is mended at the workspace's GitHub, by an owner or an admin, whom a member is told to ask.
  const deadEnd = (way: DeadEnd) =>
    chooser.manages ? (
      <MenuNoteRow
        glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
        label={GITHUB_LABEL}
        end={{ action: way.action, onClick: configure }}
      />
    ) : (
      <AskOwnersRow workspaceId={chooser.scope} ask={way.ask} />
    );
  // Note that a workspace whose row says GitHub is connected, yet whose read finds none installed, had it removed or suspended on GitHub;
  // one installed but giving us nothing has its repositories chosen on GitHub, through the workspace's row.
  const stuck =
    failure !== undefined || listed === undefined
      ? undefined
      : !listed.installed && listed.repositories.length === 0
        ? chooser.connected === true
          ? DEAD_END.LAPSED
          : DEAD_END.NOT_CONNECTED
        : rows.length === 0 && listed.installed
          ? DEAD_END.NONE_REACHED
          : undefined;
  const note =
    failure !== undefined ? (
      <ErrorState
        failure={failureShown({ surface: FAILURE_SURFACE.REPOSITORIES_READ, cause: failure })}
        onRetry={() => retry.mutate(repositoryScope(scope))}
      >
        {repositoryFailureNote(failure)}
      </ErrorState>
    ) : stuck !== undefined ? (
      deadEnd(stuck)
    ) : listed === undefined ? (
      <Spinner delay label={readingWords("repositories")} />
    ) : undefined;
  // Note that the way to the repositories' Settings ends every list but a dead end's, whose own row already leads there.
  const configurable = stuck === undefined;

  return {
    label,
    hint: value ?? undefined,
    glyph:
      value === null ? (
        none ? (
          <NoRepositoryGlyph />
        ) : (
          <GLYPH.REPOSITORY />
        )
      ) : (
        firstPicture(value, chooser.pictures)
      ),
    menu: {
      rows,
      value: value ?? undefined,
      note,
      onPick: (repository) => choose(() => props.onChoose(repository)),
      foot: [
        ...(onClear === undefined
          ? []
          : [
              {
                id: NONE_ROW,
                label: NO_REPOSITORY,
                icon: <NoRepositoryGlyph />,
                onPress: () => choose(onClear),
              },
            ]),
        ...(configurable && chooser.manages
          ? [
              {
                id: SETTINGS_ROW,
                label: SETTINGS_LABEL,
                icon: <GLYPH.SETTINGS />,
                onPress: configure,
              },
            ]
          : []),
      ],
      // A member, who cannot configure them, is told whom to ask instead.
      lastLine:
        configurable && !chooser.manages ? { words: `Ask ${whom} to ${SETTINGS_ASK}` } : undefined,
    },
  };
}

/** The repository's menu, read and placed as the chip's always was, for whatever opener draws it (`RepositoryMenu`). */
export function useRepositoryMenu(props: RepositoryMenuProps): RepositoryMenu {
  const { openRequest, onAsked, value } = props;
  const place = useMenuPlace();
  // Each ask from elsewhere, ⌘K's Change repository, opens the menu once, and is answered.
  const answered = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || openRequest === answered.current) return;
    answered.current = openRequest;
    place.ask();
    onAsked?.(openRequest);
  }, [openRequest, onAsked, place.ask]);
  const listing = useRepositoryListing(props, (pick) => {
    place.close();
    pick();
  });
  return {
    ...place,
    label: listing.label,
    hint: listing.hint,
    glyph: listing.glyph,
    card:
      value === null || place.open ? undefined : (
        <RepositoryCard repository={value} pictures={props.chooser.pictures} />
      ),
    menu: repositoryMenu(place, { ...listing.menu, align: props.align ?? POPOVER_ALIGN.END }),
  };
}

/**
 * The repository's menu standing in a menu's panel, as a task's menu holds
 * Change repository beside its item: the same search and rows as the chip's,
 * placed by the menu around it. A pick closes the whole menu, and Escape
 * goes back to the item.
 */
export function RepositoryMenuPanel(
  props: RepositoryMenuProps & {
    /** Goes back to the item that opened it, the menu standing. */
    onBack: () => void;
    /** Closes the whole menu. */
    onClose: () => void;
  },
): React.JSX.Element {
  const { onBack, onClose } = props;
  const id = useId();
  const listing = useRepositoryListing(props, (pick) => {
    onClose();
    pick();
  });
  return (
    <SearchableMenu
      {...repositoryMenuProps(listing.menu, id)}
      layer={SEARCHABLE_MENU_LAYER.EMBEDDED}
      onClose={onBack}
      onLeave={() => undefined}
    />
  );
}

/** Where a repository chip stands and what its row says of it. */
interface ChipStanding {
  place: ChipPlace;
  /** A form row's chip: how wide it stands, its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** A form row's chip: the ids of the row's words that describe it, its error among them while it has one. */
  describedBy?: string | undefined;
  /** A form row's chip: whether the row says its value is refused. */
  invalid?: true | undefined;
  /** Why the repository is held to `value` and takes no pick, said on hover; none where it may be changed. */
  held?: string | undefined;
}

export function RepositoryChip(props: RepositoryMenuProps & ChipStanding): React.JSX.Element {
  return <MenuChip {...props} menu={useRepositoryMenu(props)} named={props.value !== null} />;
}

/**
 * A press named `label` among a row's outlined buttons, over rows its caller
 * lists, as setup's Add repositories is: each pick checked, the menu standing
 * open between presses, and the press keeping its words, since what is
 * picked is listed beside it.
 */
export function CheckedRepositoryChip(props: {
  rows: readonly MenuRow[];
  picked: readonly string[];
  label: string;
  note: React.ReactNode;
  onToggle: (repository: string) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const place = useMenuPlace();
  const menu: RepositoryMenu = {
    ...place,
    label: props.label,
    hint: undefined,
    glyph: <GLYPH.ADD />,
    card: undefined,
    press: (from) => {
      if (!place.open) props.onOpen();
      place.press(from);
    },
    menu: repositoryMenu(place, {
      rows: props.rows,
      value: undefined,
      checked: checkedAmong(props.rows, props.picked),
      note: props.note,
      align: POPOVER_ALIGN.START,
      onPick: props.onToggle,
    }),
  };
  return <MenuChip place={CHIP_PLACE.ACTION} menu={menu} named={false} />;
}

/**
 * The chip a repository's menu drops from, in its place's look, and the
 * menu itself: the first pick's owner picture, or the glyph standing for
 * none, and its words, masked in a screen recording where they name a
 * repository; its hint names every pick while the menu is shut. Note that a
 * held chip is `aria-disabled` rather than disabled, because a disabled
 * button hears no pointer, and its hint says why.
 */
function MenuChip(
  props: ChipStanding & {
    menu: RepositoryMenu;
    /** Whether the words name a repository rather than the pick waited on. */
    named: boolean;
  },
): React.JSX.Element {
  const { held, menu } = props;
  return (
    <div className="repository-chip relative min-w-0" data-place={props.place} ref={menu.room}>
      <Tooltip
        label={held ?? (menu.open ? undefined : menu.hint)}
        card={held === undefined ? menu.card : undefined}
      >
        <Chip
          look={PLACE_LOOK[props.place]}
          width={props.width}
          chevron={props.place === CHIP_PLACE.FIELD}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid}
          aria-disabled={held === undefined ? undefined : true}
          aria-haspopup="dialog"
          aria-expanded={menu.open}
          aria-controls={menu.open ? menu.menuId : undefined}
          onClick={(event) => {
            if (held === undefined) menu.press(event.currentTarget);
          }}
        >
          {menu.glyph}
          <ChipName>{props.named ? <ReplayMask>{menu.label}</ReplayMask> : menu.label}</ChipName>
        </Chip>
      </Tooltip>
      {menu.menu}
    </div>
  );
}
