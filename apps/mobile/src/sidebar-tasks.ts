// sidebar-tasks.ts -- the tasks an iPad's own sidebar lists under its places, handed down from the tabs' layout so every tab's sidebar draws the one list.

import { createContext, type ReactNode, useContext } from "react";

/** The tasks' part of an iPad's sidebar, read once for every tab. */
export type SidebarTasks = {
  /** The tree's sections, as the Tasks list draws them: Managers, Pinned, Following, the member's sections, and the repository groups, each row a task's own. */
  readonly sections: ReactNode;
  /** Opens a row pressed that is no task, such as a Manager's, whose page is pushed; false for a task's, which the sidebar opens on Tasks. */
  readonly opens: (id: string) => boolean;
};

/** The tasks' part of an iPad's sidebar; none but on an iPad, where the tabs' layout holds it. */
export const SidebarTasksContext = createContext<SidebarTasks | undefined>(undefined);

/** The tasks an iPad's sidebar lists, or none where no sidebar stands. */
export function useSidebarTasks(): SidebarTasks | undefined {
  return useContext(SidebarTasksContext);
}
