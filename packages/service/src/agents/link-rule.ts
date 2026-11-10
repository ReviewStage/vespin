import { PRODUCT_NAME } from "@repo/features/product-name";

/**
 * link-rule.ts -- the one rule an author is told to name a thing of ours by: its link, built from the id a tool answered, under its workspace's address.
 *
 * A tool answers a thing of ours by its id and its name, never a mention
 * written out, so an answer costs no more than the record it already is,
 * and a thing a tool newly answers is nameable the moment it carries an id.
 * The author writes the mention from them: `[@name](<home>/<kind>/<id>)`,
 * which the app draws as the thing's chip (`@repo/features/link-grammar`).
 * The id alone finds the thing, so a workspace step that has since changed
 * still opens it. A page is the one place named by two ids, since its
 * address stands under the task or the agent on no task it was shown on.
 */

/** The rule as an author reads it, under the workspace address given: the coding agent's own, or `<workspace>` spelled out where a caller works across several. */
export function linkRuleWords(home: string): string {
  return (
    `A thing of ${PRODUCT_NAME}'s a tool answered, an agent, a task, an automation, a member, a ` +
    "thread, or a page, by its link built from the id that tool answered, " +
    `under the workspace's address \`${home}\`, its words the name it answered, never the ` +
    `name in quotes or a bare id: an agent \`${home}/agent/<agent-id>\`, a task ` +
    `\`${home}/task/<task-id>\`, an automation \`${home}/automation/<automation-id>\`, a member ` +
    `\`${home}/person/<user-id>\`, a thread \`${home}/inbox/<item-id>\`, and a page under the ` +
    `task it was shown on, \`${home}/task/<task-id>/page/<page-id>\`, or under the agent on no ` +
    `task that showed it, \`${home}/agent/<agent-id>/page/<page-id>\`; such as ` +
    `\`[@Nightly triage](${home}/automation/<automation-id>)\`.`
  );
}
