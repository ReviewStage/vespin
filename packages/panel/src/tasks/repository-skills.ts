import { SKILLS_UNANSWERED, type SkillsRead, skillsReadOf } from "@repo/features/skill-mention";
import type { TasksSkillsAnswer } from "@repo/features/tasks-view";
import { keepIdentity } from "@repo/wire";
import type { SkillSource } from "./skill-picker.js";

/**
 * repository-skills.ts -- the skills of the open task's repository a `/` in an agent's box offers, drawn at once as last read and read again behind.
 *
 * Each ask goes to the host, which answers the skills it holds at once and
 * reads them again behind the answer (`@repo/host`'s `compose-tasks.ts`),
 * so a skill added on GitHub is offered the next time a box asks; one ask
 * is out at a time, shared by every box that asks meanwhile, as TanStack
 * Query shares one read among the asks made at once (`agent-reads.ts`). An answer
 * naming the skills last read keeps their identity, so nothing drawn from
 * them is drawn again, and one that did not land, or that the service
 * refused, leaves the skills last read standing where there are any;
 * where there are none it says why, in the list's own words.
 */

/**
 * A source over the read given: each ask reads again, asks made at once
 * sharing one read through the Query cache the read is asked through, an
 * answer naming the skills last read keeping their identity, and one that
 * did not land leaving them standing.
 */
export function keptSkills(read: () => Promise<TasksSkillsAnswer>): SkillSource {
  let last: SkillsRead | undefined;

  const settle = (next: SkillsRead): SkillsRead => {
    if ("unread" in next && last !== undefined && "skills" in last) return last;
    last = last === undefined ? next : keepIdentity(last, next);

    return last;
  };

  return () =>
    read().then(
      (answer) => settle(skillsReadOf(answer)),
      () => settle({ unread: SKILLS_UNANSWERED }),
    );
}
