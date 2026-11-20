/**
 * manager-greeting.ts -- the words a Manager's conversation opens on, which the panel draws as the Manager's and its instructions repeat to it.
 *
 * A Manager starts quietly: making one opens no turn and sends no line, so
 * its conversation would open empty. The panel draws this greeting at its
 * top as the Manager's first message, though no one sent it and nothing
 * stores it, and the Manager's instructions quote it, so the Manager knows
 * what it seems to have said. Both read it here, so the two never drift.
 */

/** What a Manager greets with, by its name; without one where it has none. */
export function managerGreeting(name: string | null): string {
  const who = name === null ? "your Manager" : `${name}, a Manager`;

  return `Hi, I'm ${who}. Tell me what you want handled and I'll turn it into tasks, start agents on them, keep track of their pull requests, and come back to you only when something needs your call. What should I take on first?`;
}
