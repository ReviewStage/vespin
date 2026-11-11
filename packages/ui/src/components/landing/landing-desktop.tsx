import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { createContext, type ReactNode, useContext } from "react";
import { ChevronDownIcon, GLYPH, InboxIcon, ListTodoIcon, ZapIcon } from "../../icons/icons.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CommentsIcon,
  ComposeIcon,
  GearIcon,
  SearchIcon,
  SidebarIcon,
  SidePanelIcon,
} from "../../icons/lucide-glyphs.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { IconButton } from "../button/button.js";
import { GROUP_HEADING, GroupHeader } from "../group-header/group-header.js";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { NAV_CURRENT, NAV_ITEM_VARIANT, NavItem } from "../nav-item/nav-item.js";
import { SidebarPlaces, SidebarRule } from "../sidebar/sidebar.js";
import { TEXT_ELEMENT, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { Time } from "../time/time.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import { MINUTE, STORY_NOW, still } from "./landing-story.js";

/**
 * landing-desktop.tsx -- the Mac app's frame as the landing's windows draw it: the title bar's controls, the sidebar, and an agent's face.
 *
 * The sidebar is the desktop's own: the title bar's sidebar toggle and way
 * back and forward over the workspace and its New task, the places, and My
 * tasks under each task's repository, with the account's foot, its
 * feedback, and its settings. Its tasks and the workspace are one made-up team's,
 * acme, building teammate invitations. Every part is a `@repo/ui` component
 * placed as the panel places it (`packages/panel/src/desktop/desktop-sidebar.tsx`).
 */

/** The page on show, which the sidebar marks among its places. */
export const DESKTOP_PLACE = {
  INBOX: "inbox",
  TASK: "task",
  AUTOMATIONS: "automations",
} as const;

export type DesktopPlace = (typeof DESKTOP_PLACE)[keyof typeof DESKTOP_PLACE];

/** One of My tasks: its status, its name, whether an agent is at work on it, and how long ago it moved. */
type SidebarTask = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly working: boolean;
  readonly ago: number;
};

/** My tasks, under the repository each works in. */
const MY_TASKS: readonly { readonly repository: string; readonly tasks: readonly SidebarTask[] }[] =
  [
    {
      repository: "relay",
      tasks: [
        {
          id: "invites",
          name: "Teammate invitations",
          status: TASK_STATUS.IN_PROGRESS,
          working: true,
          ago: 1,
        },
        {
          id: "digest",
          name: "Weekly digest email",
          status: TASK_STATUS.IN_PROGRESS,
          working: true,
          ago: 25,
        },
      ],
    },
    {
      repository: "ledger",
      tasks: [
        {
          id: "export",
          name: "Billing export",
          status: TASK_STATUS.TODO,
          working: false,
          ago: 180,
        },
      ],
    },
  ];

/** The member at the account's foot. */
export const MEMBER = "Sam Reyes";

/** The member's picture the landing was handed, which each of their faces draws; none draws their letter. */
const MemberPicture = createContext<string | undefined>(undefined);

/** Hands `picture` to every face of the member's drawn inside it. */
export function MemberPictureProvider({
  picture,
  children,
}: {
  picture: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <MemberPicture.Provider value={picture}>{children}</MemberPicture.Provider>;
}

/** The member's picture, where the landing was handed one. */
export function useMemberPicture(): string | undefined {
  return useContext(MemberPicture);
}

/** The member's face at `size`: their picture where the landing was handed one, else their letter. */
export function MemberFace({
  size,
}: {
  size: (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE];
}): React.JSX.Element {
  return <Avatar name={MEMBER} src={useMemberPicture()} size={size} decorative />;
}

/** acme's made-up logo, two white peaks on an indigo square, as a picture its tile is filled with. */
const ACME_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#4f46e5"/><path d="M12 8 21 24H3Z" fill="#fff"/><path d="M21 13 29 24H14Z" fill="#fff" fill-opacity=".6"/></svg>',
)}`;

/** An agent's face: its name on the square of the harness it runs in. */
export function agentFace(
  name: string,
  size: (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE],
): ReactNode {
  return (
    <Avatar
      name={name}
      shape={AVATAR_SHAPE.SQUARE}
      size={size}
      glyph={<HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />}
      decorative
    />
  );
}

/** The title bar's controls over the sidebar: its toggle, and the way back and forward at its end. */
function TitleBarControls(): React.JSX.Element {
  return (
    <div className="ui-landing-title-bar">
      <span className="ui-landing-title-bar-start">
        <IconButton icon={<SidebarIcon />} label="Hide sidebar" onClick={still} />
      </span>
      <span className="ui-landing-title-bar-history">
        <IconButton icon={<ArrowLeftIcon />} label="Back" onClick={still} />
        <IconButton icon={<ArrowRightIcon />} label="Forward" disabled onClick={still} />
      </span>
    </div>
  );
}

/** The window's side-panel toggle at its top right. */
export function SidePanelToggle(): React.JSX.Element {
  return (
    <span className="ui-landing-title-bar-end">
      <IconButton icon={<SidePanelIcon />} label="Hide side panel" onClick={still} />
    </span>
  );
}

/** The desktop's sidebar, `place` marked among its places and `openTask` among My tasks. */
export function DesktopSidebar({
  place,
  openTask,
}: {
  place: DesktopPlace;
  openTask?: string | undefined;
}): React.JSX.Element {
  return (
    <aside className="ui-landing-sidebar">
      <TitleBarControls />
      <div className="ui-landing-workspace">
        <NavItem variant={NAV_ITEM_VARIANT.IDENTITY} mark={<ChevronDownIcon />}>
          <span className="ui-landing-workspace-ref">
            <Avatar
              name="acme"
              size={AVATAR_SIZE.CARD}
              shape={AVATAR_SHAPE.TILE}
              src={ACME_LOGO}
              decorative
            />
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
              acme
            </Text>
          </span>
        </NavItem>
        <IconButton icon={<ComposeIcon />} label="New task" onClick={still} />
      </div>
      <SidebarPlaces label="Places">
        <NavItem icon={<SearchIcon />}>Search</NavItem>
        <NavItem icon={<GLYPH.HOME />}>Home</NavItem>
        <NavItem
          icon={<InboxIcon />}
          current={place === DESKTOP_PLACE.INBOX ? NAV_CURRENT.PAGE : undefined}
          count={{ value: 2, noun: "need you", tone: STATUS_TONE.ATTENTION }}
        >
          Inbox
        </NavItem>
        <NavItem icon={<ListTodoIcon />}>Tasks</NavItem>
        <NavItem
          icon={<ZapIcon />}
          current={place === DESKTOP_PLACE.AUTOMATIONS ? NAV_CURRENT.PAGE : undefined}
        >
          Automations
        </NavItem>
      </SidebarPlaces>
      <SidebarRule />
      <nav className="ui-landing-sidebar-group" aria-label="My tasks">
        <GroupHeader heading={GROUP_HEADING.NONE} label="My tasks" />
        {MY_TASKS.map((group) => (
          <div key={group.repository} className="ui-landing-repository">
            <GroupHeader
              heading={GROUP_HEADING.NONE}
              glyph={<GLYPH.REPOSITORY />}
              label={group.repository}
            />
            <List label={group.repository} density={LIST_DENSITY.DENSE}>
              {group.tasks.map((task) => (
                <ListRow
                  key={task.id}
                  motionKey={task.id}
                  density={LIST_DENSITY.DENSE}
                  ink={LIST_ROW_INK.SIDEBAR}
                  leading={<TaskStatusMark status={task.status} />}
                  title={task.name}
                  meta={
                    <span className="ui-landing-row-time">
                      {task.working ? <WorkingMark /> : null}
                      <Time at={STORY_NOW - task.ago * MINUTE} now={STORY_NOW} hint={false} />
                    </span>
                  }
                  current={task.id === openTask ? LIST_ROW_CURRENT.PAGE : undefined}
                  onPress={still}
                />
              ))}
            </List>
          </div>
        ))}
      </nav>
      <div className="ui-landing-sidebar-foot">
        <NavItem
          variant={NAV_ITEM_VARIANT.IDENTITY}
          icon={<MemberFace size={AVATAR_SIZE.ACCOUNT} />}
        >
          {MEMBER}
        </NavItem>
        <IconButton icon={<CommentsIcon />} label="Send feedback" onClick={still} />
        <IconButton icon={<GearIcon />} label="Settings" onClick={still} />
      </div>
    </aside>
  );
}
