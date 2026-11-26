/**
 * office-shared.tsx -- PROTOTYPE, throwaway: the labels every office variant draws: a nameplate, a status chip, an ask slip, the whiteboard.
 */

import { Badge, STATUS_TONE } from "@repo/ui";
import { MANAGER_STATUS, type ManagerStatus, type OfficeManager } from "./office-data";
import { Face, RowFace } from "./shared";

export const STATUS_WORDS: Record<ManagerStatus, string> = {
  [MANAGER_STATUS.WAITING]: "Waiting on you",
  [MANAGER_STATUS.WORKING]: "Working",
  [MANAGER_STATUS.IDLE]: "Idle",
};

export function StatusChip({ status }: { status: ManagerStatus }): React.JSX.Element {
  const tone =
    status === MANAGER_STATUS.WAITING
      ? STATUS_TONE.ATTENTION
      : status === MANAGER_STATUS.WORKING
        ? STATUS_TONE.WORKING
        : STATUS_TONE.NEUTRAL;
  return <Badge tone={tone}>{STATUS_WORDS[status]}</Badge>;
}

/** A Manager's nameplate: face, name, role, status, and what it is on in one line. */
export function Nameplate({
  m,
  status,
  compact,
}: {
  m: OfficeManager;
  status: ManagerStatus;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className="of-plate" data-status={status}>
      {compact ? <RowFace m={m} /> : <Face m={m} />}
      <div className="of-plate-words">
        <div className="of-plate-head">
          <span className="of-plate-name">{m.name}</span>
          <span className="of-plate-role">{m.role}</span>
        </div>
        <div className="of-plate-focus">{m.focus}</div>
      </div>
      <StatusChip status={status} />
    </div>
  );
}

/** One ask on a slip, unmistakably the reader's. */
export function AskSlip({
  m,
  title,
  age,
}: {
  m: OfficeManager;
  title: string;
  age: string;
}): React.JSX.Element {
  return (
    <div className="of-slip">
      <RowFace m={m} />
      <div className="of-slip-words">
        <div className="of-slip-title">{title}</div>
        <div className="of-slip-meta">
          {m.name} · {age}
        </div>
      </div>
    </div>
  );
}
