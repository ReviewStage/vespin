/**
 * mention-holder.ts -- what holds a place's mentions: a task's page.
 *
 * A task's page offers its description's sections and its pages, and draws a
 * section of its own description as found or gone. A place no task holds, as
 * New task's composer and the window's Inbox are, has no holder, and offers
 * neither.
 */

/** What holds a place's mentions: the task whose page it is, by its id; none where no task holds the place. */
export type MentionHolder = { readonly taskId: string };
