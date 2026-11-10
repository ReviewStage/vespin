/**
 * task-section-writes.ts -- what a change to the sidebar's sections leaves them as, so the host draws a write before the service answers it and a window works out an Undo from it.
 *
 * Every function is pure over the account's sections as the service last
 * answered them (`task-section-wire.ts`), and answers them as the service
 * will keep them once it has taken the write.
 */

import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "./task-section-wire.js";

/** An entry for the task, in the section, put there at `addedAt`. */
export function entryFor(
  taskId: string,
  sectionId: string,
  addedAt: number,
  position?: string,
): TaskSectionEntry {
  const where = position === undefined ? undefined : { position };
  return { taskId, sectionId, addedAt, ...where };
}

/** A task put in a section, or moved within it, as the service would keep it. */
function placed(
  state: TaskSections,
  taskId: string,
  write: { readonly sectionId: string | null; readonly position?: string },
  now: number,
): TaskSections {
  const { sectionId, position } = write;
  const others = state.entries.filter((entry) => entry.taskId !== taskId);
  if (sectionId === null) return { ...state, entries: others };
  if (!state.sections.some((section) => section.id === sectionId)) return state;
  const standing = state.entries.find((entry) => entry.taskId === taskId);
  const kept = standing?.sectionId === sectionId ? standing : undefined;
  const where = position ?? kept?.position;
  return {
    ...state,
    entries: [...others, entryFor(taskId, sectionId, kept?.addedAt ?? now, where)],
  };
}

/**
 * The sections as the service will answer them once it has taken `write`,
 * made at `now`: a section made, edited, moved, or deleted with its
 * entries, or a task put in a section or in none. A write naming a section
 * the state does not hold changes nothing, as the service refuses it, and
 * so does one placing an agent with no task, which no client sends any more.
 */
export function applySectionWrite(
  state: TaskSections,
  write: TaskSectionWrite,
  now: number,
): TaskSections {
  switch (write.kind) {
    case TASK_SECTION_WRITE.CREATE: {
      if (state.sections.some((section) => section.id === write.id)) return state;
      const { id, workspaceId, title, icon } = write;
      const made: TaskSection = {
        id,
        workspaceId,
        title,
        createdAt: now,
        ...(icon === undefined ? undefined : { icon }),
      };
      return { ...state, sections: [...state.sections, made] };
    }
    case TASK_SECTION_WRITE.EDIT:
      return {
        ...state,
        sections: state.sections.map((section) => {
          if (section.id !== write.id) return section;
          const { icon: _, ...rest } = section;
          return {
            ...rest,
            title: write.title,
            ...(write.icon === null ? undefined : { icon: write.icon }),
          };
        }),
      };
    case TASK_SECTION_WRITE.MOVE:
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === write.id ? { ...section, position: write.position } : section,
        ),
      };
    case TASK_SECTION_WRITE.DELETE:
      return {
        ...state,
        sections: state.sections.filter((section) => section.id !== write.id),
        entries: state.entries.filter((entry) => entry.sectionId !== write.id),
      };
    case TASK_SECTION_WRITE.PLACE:
      return placed(state, write.taskId, write, now);
    case TASK_SECTION_WRITE.PLACE_AGENT:
      return state;
  }
}
