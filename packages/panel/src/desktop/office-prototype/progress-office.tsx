/**
 * progress-office.tsx -- PROTOTYPE, throwaway: three ways to see what each Manager is working toward and what moved since you looked, built from @repo/ui alone.
 */

import {
  CardPress,
  DetailPage,
  PAGE_FRAME,
  PAGE_WIDTH,
  PROGRESS_SIZE,
  PROGRESS_WIDTH,
  Progress,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { Fragment } from "react";
import { OFFICE_VARIANT, type OfficeVariant } from "./office-params.js";
import {
  type GoalManager,
  hourWords,
  LOOKED,
  LOOKED_WORDS,
  listed,
  NOW,
  newSteps,
  TEAM,
} from "./progress-data.js";
import "./office.css";

const noop = () => {};

/** What comes next, or what it waits on you for, as one short clause. */
function After({ m }: { m: GoalManager }): React.JSX.Element {
  if (m.waiting !== undefined) {
    return <span className="pg-waiting">{`Waiting on you: ${m.waiting}`}</span>;
  }
  return <span className="pg-muted">{`Next: ${m.next ?? ""}`}</span>;
}

/** Idea one: a rail per goal, filled as its steps land, what landed since you looked in the ink. */
function Rails(): React.JSX.Element {
  return (
    <div className="pg-rails">
      {TEAM.map((m) => {
        const fresh = newSteps(m);
        const value = (m.done / m.total) * 100;
        const since = (fresh.length / m.total) * 100;
        return (
          <div key={m.id} className="pg-rail">
            <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} />
            <div className="pg-rail-body">
              <div className="pg-rail-head">
                <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                  {m.goal}
                </Text>
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                  {m.name}
                </Text>
              </div>
              <Progress
                value={value}
                since={since}
                size={PROGRESS_SIZE.BOLD}
                width={PROGRESS_WIDTH.FILL}
              />
              <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.P}>
                {fresh.length > 0 ? (
                  <span className="pg-new">{`New: ${listed(fresh.map((s) => s.what))}`}</span>
                ) : (
                  <span className="pg-muted">Nothing new</span>
                )}
                <span className="pg-muted">{" · "}</span>
                <After m={m} />
              </Text>
            </div>
            <CardPress onPress={noop} label={`Open ${m.name}`} />
          </div>
        );
      })}
    </div>
  );
}

/** A letter paragraph, its `**…**` bits in the ink and the rest quiet. */
function Marked({ text }: { text: string }): React.JSX.Element {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="pg-new">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Idea two: a short letter catching you up, a paragraph per Manager that moved, and what waits on you at its end. */
function Letter(): React.JSX.Element {
  const moved = TEAM.filter((m) => newSteps(m).length > 0);
  const waiting = TEAM.filter((m) => m.waiting !== undefined);
  const quiet = TEAM.filter((m) => newSteps(m).length === 0 && m.waiting === undefined);
  return (
    <div className="pg-letter">
      <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.P}>
        Hi Ada,
      </Text>
      <Text
        as={TEXT_ELEMENT.P}
      >{`Since you looked at ${LOOKED_WORDS}, ${moved.length} of your Managers moved their work forward.`}</Text>
      {moved
        .filter((m) => m.waiting === undefined)
        .map((m) => (
          <div key={m.id} className="pg-letter-para">
            <span className="pg-letter-face">
              <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.ROW} />
            </span>
            <Text as={TEXT_ELEMENT.P}>
              <Marked text={m.letter} />
            </Text>
            <CardPress onPress={noop} label={`Open ${m.name}`} />
          </div>
        ))}
      <div className="pg-letter-ask">
        <Text as={TEXT_ELEMENT.P}>
          <span className="pg-waiting">{`${waiting.length === 1 ? "One thing waits" : "Two things wait"} on you. `}</span>
          {waiting.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 ? " " : null}
              <Marked text={m.letter} />
            </Fragment>
          ))}
        </Text>
      </div>
      {quiet.length > 0 ? (
        <Text
          as={TEXT_ELEMENT.P}
          tone={TEXT_TONE.MUTED}
        >{`${listed(quiet.map((m) => m.name))} had a quiet day.`}</Text>
      ) : null}
      <Text as={TEXT_ELEMENT.P} tone={TEXT_TONE.MUTED}>
        Your team
      </Text>
    </div>
  );
}

const START = 8;
const END = 19;
const at = (h: number) => `${((h - START) / (END - START)) * 100}%`;

/** Idea three: the day as a river, a lane per goal flowing left to right, everything right of where you last looked new. */
function River(): React.JSX.Element {
  const hours = [8, 10, 12, 14, 16, 18];
  return (
    <div className="pg-river">
      <div className="pg-river-axis">
        <span />
        <div className="pg-river-track">
          {hours.map((h) => (
            <span key={h} className="pg-river-hour" style={{ left: at(h) }}>
              {hourWords(h).replace(":00", "")}
            </span>
          ))}
        </div>
      </div>
      <div className="pg-river-lanes">
        <div
          className="pg-river-since"
          style={{
            left: `calc(var(--pg-lane-label) + (100% - var(--pg-lane-label)) * ${(LOOKED - START) / (END - START)})`,
            right: `calc((100% - var(--pg-lane-label)) * ${(END - NOW) / (END - START)})`,
          }}
        >
          <span className="pg-river-since-label">{`New since you looked · ${LOOKED_WORDS}`}</span>
        </div>
        {TEAM.map((m) => (
          <div key={m.id} className="pg-lane">
            <div className="pg-lane-label">
              <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} />
              <div className="pg-lane-words">
                <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                  {m.goal}
                </Text>
                <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
                  <After m={m} />
                </Text>
              </div>
            </div>
            <div className="pg-river-track">
              <span
                className="pg-lane-since"
                style={{ left: at(LOOKED), right: `calc(100% - ${at(NOW)})` }}
              />
              <span className="pg-lane-line" style={{ right: `calc(100% - ${at(NOW)})` }} />
              {m.steps.map((s) => (
                <span
                  key={s.what}
                  className="pg-step"
                  data-new={s.at > LOOKED ? "true" : undefined}
                  style={{ left: at(s.at) }}
                >
                  <span className="pg-step-dot" />
                  {s.at > LOOKED ? <span className="pg-step-label">{s.what}</span> : null}
                </span>
              ))}
            </div>
            <CardPress onPress={noop} label={`Open ${m.name}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressOffice({ variant }: { variant: OfficeVariant }): React.JSX.Element {
  if (variant === OFFICE_VARIANT.LETTER) {
    return (
      <DetailPage frame={PAGE_FRAME.PAGE} title="While you were away">
        <Letter />
      </DetailPage>
    );
  }
  return (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      title="Today"
      description={`Since you looked at ${LOOKED_WORDS}`}
      width={variant === OFFICE_VARIANT.RIVER ? PAGE_WIDTH.FULL : undefined}
    >
      {variant === OFFICE_VARIANT.RIVER ? <River /> : <Rails />}
    </DetailPage>
  );
}
