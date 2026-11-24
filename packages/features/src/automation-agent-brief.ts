/**
 * automation-agent-brief.ts -- what Create with an agent hands the agent it starts, on the desktop's Automations page and the phone's tab alike: a fixed brief, then the member's own words fenced as their request.
 *
 * The brief is the same for every request, written here rather than by a
 * model, so what the agent is told to do, and which automations tools it is
 * told to do it with, changes only with this file. The member's words follow
 * it whole, in a fence longer than any run of backticks they hold, so
 * nothing they wrote closes the fence and reads as the brief.
 */

import { LINK_ORIGIN } from "./link-home.js";
import { fencedBlock } from "./markdown-fence.js";

/** The brief every Create with an agent opens with, ahead of the request. */
const BRIEF = `# Create an automation

A member asked on the Automations page for an automation that does what their request below says. Make it for them:

1. Work out its trigger, as \`create_automation\` describes the triggers it takes (a webhook is made only on the Automations page), the repositories its runs work in, its prompt, its model and effort, the machine its runs start on (\`list_machines\` lists them), and the connections its runs need.
2. Decide what you can yourself. Ask the member in their inbox only for what you cannot, such as a choice their words leave open.
3. Read the workspace's automations with \`list_automations\`, so you make none that one already does, and check the automations tools can do what is needed. Where they cannot, say so rather than make something else.
4. Create it with \`create_automation\`.
5. Reply with what you made: its name as a link to it, \`[<name>](${LINK_ORIGIN}/<workspace>/automation/<id>)\`, by the id \`create_automation\` answered and the workspace in your task's own link, its trigger, and what each run does.`;

/** What leads the member's words in. */
const REQUEST_LEAD = "Their request, in their own words:";

/** What Create with an agent's card says, the desktop's and the phone's alike: its title, what its field asks for and is called, and why a request too long for an agent's first message is refused. */
export const CREATE_WITH_AGENT_WORDS = {
  TITLE: "Create with an agent",
  PLACEHOLDER: "Describe what to automate",
  LABEL: "What to automate",
  TOO_LONG: "That request is too long.",
} as const;

/** The agent's first message for a request: the brief, then the request fenced, trimmed of the space around it. */
export function automationAgentBrief(request: string): string {
  return `${BRIEF}\n\n${REQUEST_LEAD}\n\n${fencedBlock(request.trim(), "text")}`;
}
