/**
 * person-page-words.ts -- what a person's page says, on the panel and the phone alike: its sections' names, who the person is to the workspace where they are no member, and its menu's acts.
 *
 * A section the reader's own page names to them ("Assigned to you") is
 * named plainly on a teammate's ("Assigned"), and what waits is the
 * Inbox's own Needs you on the reader's page.
 */

import { NEEDS_YOU } from "./inbox-list-model.js";

/** The page's fixed words. */
export const PERSON_PAGE_WORDS = {
  /** What its ⋯ is called, on its button and its menu alike. */
  PERSON: "Person",
  WORKING: "Working now",
  AGENTS: "Agents",
  /** Someone who left the workspace, in the place of a member's role and email. */
  FORMER: "Former member",
  /** Someone neither the members nor those who left name. */
  OUTSIDE: "Not in this workspace",
  COPY_EMAIL: "Copy email",
  EMAIL_COPIED: "Email copied",
  /** The workspace's members in Settings, for its owners and admins. */
  MANAGE: "Manage in workspace settings",
} as const;

/** What the reader's own page says to them, each as it reads there and on a teammate's. */
export const PERSON_SECTION_WORDS = {
  WAITING: { YOURS: NEEDS_YOU.LABEL, THEIRS: "Waiting on their answer" },
  ASSIGNED: { YOURS: "Assigned to you", THEIRS: "Assigned" },
  CREATED: { YOURS: "Created by you", THEIRS: "Created" },
  SHOW_TASKS: { YOURS: "Show my tasks in the sidebar", THEIRS: "Show their tasks in the sidebar" },
  /** What the page says once every read answered and it lists nothing. */
  NOTHING: { YOURS: "Nothing of yours here yet.", THEIRS: "Nothing of theirs here yet." },
  /** What it says where the person could not be read, with Retry. */
  UNREAD: { YOURS: "Your profile could not be read.", THEIRS: "Their profile could not be read." },
} as const;

/** What the page says, a section's name among it, as the reader's own page says it to them, and plainly on a teammate's. */
export function personWords(
  section: (typeof PERSON_SECTION_WORDS)[keyof typeof PERSON_SECTION_WORDS],
  you: boolean,
): string {
  return you ? section.YOURS : section.THEIRS;
}
