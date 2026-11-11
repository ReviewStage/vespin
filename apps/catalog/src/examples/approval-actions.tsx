import { APPROVAL_ACTION, APPROVAL_COMMAND_PLACE, ApprovalActions, GAP, Stack } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * approval-actions.tsx -- the answers under a tool call an agent holds:
 * presses that say which was given once one is pressed, and a press still
 * out, and Always allow naming the command it keeps for every agent, in its
 * press or on a line under them.
 */

/** The words each answer is said back in. */
const GIVEN = {
  [APPROVAL_ACTION.ALLOW]: "Allowed",
  [APPROVAL_ACTION.ALLOW_FOR_AGENT]: "Always allowed",
  [APPROVAL_ACTION.DENY]: "Denied",
} as const;

/** The presses, which give way to the answer given once one is pressed. */
function Answerable(): React.JSX.Element {
  const [given, setGiven] = useState<string | undefined>(undefined);
  if (given !== undefined) return <span>{given}</span>;
  return (
    <ApprovalActions
      noteMaxLength={4_000}
      onAnswer={(action, message) =>
        setGiven(message === undefined ? GIVEN[action] : `${GIVEN[action]}: ${message}`)
      }
    />
  );
}

function ApprovalActionsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="approval-actions-waiting" title="Waiting on an answer">
        <Answerable />
      </CatalogSection>
      <CatalogSection id="approval-actions-command" title="Always allow naming its command">
        <Stack gap={GAP.BLOCK}>
          <ApprovalActions command="pnpm test *" onAnswer={() => undefined} />
          <ApprovalActions
            command="pnpm test *"
            commandPlace={APPROVAL_COMMAND_PLACE.UNDER}
            onAnswer={() => undefined}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="approval-actions-answering" title="An answer out">
        <Stack gap={GAP.BLOCK}>
          <ApprovalActions answering={APPROVAL_ACTION.ALLOW} onAnswer={() => undefined} />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const APPROVAL_ACTIONS_EXAMPLE: Example = {
  id: "approval-actions",
  title: "Approval actions",
  Render: ApprovalActionsExample,
};
