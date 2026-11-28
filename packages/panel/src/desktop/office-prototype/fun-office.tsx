/**
 * fun-office.tsx -- PROTOTYPE, throwaway: three playful scenes of the team's progress, almost without words: a garden, a running track, and a city at night.
 *
 * Each Manager's goal is something that grows as its steps land, and what
 * landed since you last looked grows in front of you as the page opens. One
 * that needs you asks in a bubble of a few words; one that moved nothing
 * dozes.
 */

import { DetailPage, PAGE_FRAME, PAGE_WIDTH } from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace, type ManagerFaceSize } from "@repo/ui/manager-face";
import { useEffect, useState } from "react";
import { OFFICE_VARIANT, type OfficeVariant } from "./office-params.js";
import { type GoalManager, newSteps, TEAM } from "./progress-data.js";
import "./office.css";

/** What a Manager that needs you asks, in a few words. */
const ASK: Record<string, string> = {
  storage: "Clean up?",
  design: "Density?",
};

const MOOD = {
  MOVING: "moving",
  ASKING: "asking",
  QUIET: "quiet",
} as const;

type Mood = (typeof MOOD)[keyof typeof MOOD];

function moodOf(m: GoalManager): Mood {
  if (m.waiting !== undefined) return MOOD.ASKING;
  return newSteps(m).length > 0 ? MOOD.MOVING : MOOD.QUIET;
}

const PHONE = typeof window !== "undefined" && window.innerWidth < 700;

/** The room the scene has under the page's title, so it fills the pane rather than its top. */
const ROOM_H =
  typeof window === "undefined" ? 700 : Math.max(420, window.innerHeight - (PHONE ? 220 : 170));
/** The pane's width beside the sidebar, which the city's buildings share. */
const ROOM_W =
  typeof window === "undefined" ? 1100 : PHONE ? window.innerWidth - 48 : window.innerWidth - 330;

/** Plays the scene's opening once it is on screen, as a reader arriving would see it. */
function usePlay(): boolean {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setPlay(true), 150);
    // Note that a capture replays the opening by flipping this off and on.
    (window as unknown as { replayScene?: () => void }).replayScene = () => {
      setPlay(false);
      window.setTimeout(() => setPlay(true), 60);
    };
    return () => window.clearTimeout(id);
  }, []);
  return play;
}

function Bubble({ m }: { m: GoalManager }): React.JSX.Element | null {
  const ask = ASK[m.id];
  if (ask === undefined) return null;
  return <span className="fun-bubble">{ask}</span>;
}

function Zzz(): React.JSX.Element {
  return (
    <span className="fun-zzz" aria-hidden="true">
      z<span>z</span>
      <span>z</span>
    </span>
  );
}

function Face({ m, size }: { m: GoalManager; size: ManagerFaceSize }): React.JSX.Element {
  return <ManagerFace face={m.face} size={size} working={moodOf(m) === MOOD.MOVING} />;
}

/* ---------- Garden ---------- */

const PLANT_H = PHONE ? 150 : Math.min(460, Math.max(220, ROOM_H - 230));

/** A plant growing out of a Manager's head: a leaf per step done, the new ones sprouting as you look, a bud where its goal is. */
function Plant({ m }: { m: GoalManager }): React.JSX.Element {
  const mood = moodOf(m);
  const fresh = newSteps(m).length;
  const old = m.done - fresh;
  const step = PLANT_H / m.total;
  const height = m.done * step;
  const w = 80;
  return (
    <div className="fun-plant" data-mood={mood}>
      <div className="fun-plant-air">
        {mood === MOOD.ASKING ? <Bubble m={m} /> : null}
        {mood === MOOD.QUIET ? <Zzz /> : null}
      </div>
      <svg
        width={w}
        height={PLANT_H + 16}
        viewBox={`0 0 ${w} ${PLANT_H + 16}`}
        aria-hidden="true"
        className="fun-plant-svg"
      >
        <line x1={w / 2} x2={w / 2} y1={PLANT_H + 16} y2={16} className="fun-plant-goal" />
        <circle cx={w / 2} cy={10} r={8} className="fun-plant-bud" />
        <g
          className="fun-plant-stem-wrap"
          style={{ "--fun-from": `${old / m.done || 0}` } as React.CSSProperties}
        >
          <line
            x1={w / 2}
            x2={w / 2}
            y1={PLANT_H + 16}
            y2={PLANT_H + 16 - height}
            className="fun-plant-stem"
          />
        </g>
        {Array.from({ length: m.done }, (_, i) => {
          const y = PLANT_H + 16 - (i + 0.6) * step;
          const left = i % 2 === 0;
          const isNew = i >= old;
          return (
            <g
              key={i}
              transform={`rotate(${left ? -28 : 28} ${left ? w / 2 - 11 : w / 2 + 11} ${y})`}
            >
              <ellipse
                cx={left ? w / 2 - 11 : w / 2 + 11}
                cy={y}
                rx={11}
                ry={5.5}
                className="fun-leaf"
                data-new={isNew ? "true" : undefined}
                style={{ "--fun-delay": `${0.9 + (i - old) * 0.35}s` } as React.CSSProperties}
              />
            </g>
          );
        })}
      </svg>
      <span className="fun-plant-face">
        <Face m={m} size={MANAGER_FACE_SIZE.PORTRAIT} />
      </span>
      <span className="fun-name">{m.name}</span>
    </div>
  );
}

function Garden(): React.JSX.Element {
  return (
    <div className="fun-garden" style={{ minHeight: ROOM_H }}>
      <div className="fun-garden-stage">
        <div className="fun-garden-row">
          {TEAM.map((m) => (
            <Plant key={m.id} m={m} />
          ))}
        </div>
        <div className="fun-garden-sill" />
      </div>
    </div>
  );
}

/* ---------- Track ---------- */

const TRACK = PHONE
  ? { w: 340, h: 520, lane: 15, inner: 70 }
  : { w: 1060, h: 560, lane: 30, inner: 110 };

function lanePath(i: number): { path: string; rx: number; ry: number; cx: number; cy: number } {
  const cx = TRACK.w / 2;
  const cy = TRACK.h / 2;
  // Note that a phone's track stands upright, so the lanes run tall rather than wide.
  const rx = PHONE ? TRACK.inner * 0.55 + i * TRACK.lane : TRACK.inner * 2.4 + i * TRACK.lane;
  const ry = PHONE ? TRACK.inner * 1.6 + i * TRACK.lane : TRACK.inner * 0.75 + i * TRACK.lane;
  const path = `M ${cx} ${cy - ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy + ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy - ry}`;
  return { path, rx, ry, cx, cy };
}

function Track(): React.JSX.Element {
  const lanes = TEAM.map((m, i) => ({ m, ...lanePath(i) }));
  const outer = lanePath(TEAM.length - 0.5);
  const inner = lanePath(-0.5);
  return (
    <div className="fun-track" style={{ width: TRACK.w, height: TRACK.h }}>
      <svg
        width={TRACK.w}
        height={TRACK.h}
        viewBox={`0 0 ${TRACK.w} ${TRACK.h}`}
        aria-hidden="true"
      >
        <ellipse
          cx={outer.cx}
          cy={outer.cy}
          rx={outer.rx}
          ry={outer.ry}
          className="fun-track-ground"
        />
        <ellipse
          cx={inner.cx}
          cy={inner.cy}
          rx={inner.rx}
          ry={inner.ry}
          className="fun-track-infield"
        />
        {lanes.map(({ m, rx, ry, cx, cy }) => (
          <ellipse key={m.id} cx={cx} cy={cy} rx={rx} ry={ry} className="fun-track-lane" />
        ))}
        {lanes.map(({ m, path }) => {
          const was = ((m.done - newSteps(m).length) / m.total) * 100;
          const now = (m.done / m.total) * 100;
          return (
            <g key={m.id}>
              <path
                d={path}
                pathLength={100}
                className="fun-track-past"
                style={
                  {
                    "--fun-was": was,
                    stroke: `var(--ui-color-manager-face-${m.face.color})`,
                  } as React.CSSProperties
                }
              />
              <path
                d={path}
                pathLength={100}
                className="fun-track-trail"
                data-mood={moodOf(m)}
                style={
                  {
                    "--fun-was": was,
                    "--fun-now": now,
                    stroke: `var(--ui-color-manager-face-${m.face.color})`,
                  } as React.CSSProperties
                }
              />
            </g>
          );
        })}
        <line
          x1={TRACK.w / 2}
          x2={TRACK.w / 2}
          y1={inner.cy - inner.ry}
          y2={outer.cy - outer.ry}
          className="fun-track-finish"
        />
      </svg>
      <span
        className="fun-flag"
        style={{ left: TRACK.w / 2 + 6, top: outer.cy - outer.ry - 34 }}
        aria-hidden="true"
      >
        🏁
      </span>
      {lanes.map(({ m, path }) => {
        const mood = moodOf(m);
        const was = ((m.done - newSteps(m).length) / m.total) * 100;
        const now = (m.done / m.total) * 100;
        return (
          <span
            key={m.id}
            className="fun-runner"
            data-mood={mood}
            style={
              {
                offsetPath: `path("${path}")`,
                "--fun-was": `${was}%`,
                "--fun-now": `${now}%`,
              } as React.CSSProperties
            }
          >
            <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} />
            {mood === MOOD.ASKING ? <Bubble m={m} /> : null}
            {mood === MOOD.QUIET ? <Zzz /> : null}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- City ---------- */

const FLOOR = PHONE ? 14 : Math.max(24, Math.min(46, Math.floor((ROOM_W - 260 - 72) / 20)));
const FLOOR_H = PHONE
  ? 13
  : Math.max(24, Math.min(72, Math.floor((ROOM_H - 56 - 30 - 130) / 6) - 6));

/** A Manager's building: a lit window per step done, the new ones switching on as you look, dark ones still to build. */
function Building({ m, i }: { m: GoalManager; i: number }): React.JSX.Element {
  const mood = moodOf(m);
  const fresh = newSteps(m).length;
  const old = m.done - fresh;
  const widths = [3, 2, 3, 2, 2, 3, 2, 3];
  const cols = widths[i % widths.length] ?? 2;
  const floors = Math.ceil(m.total / cols) + 1;
  return (
    <div
      className="fun-building"
      data-mood={mood}
      style={{ "--fun-ink": `var(--ui-color-manager-face-${m.face.color})` } as React.CSSProperties}
    >
      <div className="fun-roof">
        {mood === MOOD.ASKING ? <Bubble m={m} /> : null}
        {mood === MOOD.QUIET ? <Zzz /> : null}
        <Face m={m} size={MANAGER_FACE_SIZE.PORTRAIT} />
      </div>
      <div
        className="fun-tower"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${FLOOR}px)`,
          minHeight: floors * (FLOOR_H + 6),
          gridAutoRows: `${FLOOR_H}px`,
        }}
      >
        {Array.from({ length: m.total }, (_, k) => {
          // Note that windows fill from the ground up, so a building lights from its foot.
          const n = m.total - 1 - k;
          const lit = n < m.done;
          const isNew = n >= old && n < m.done;
          return (
            <span
              key={k}
              className="fun-window"
              data-lit={lit ? "true" : undefined}
              data-new={isNew ? "true" : undefined}
              style={{ "--fun-delay": `${0.6 + (n - old) * 0.45}s` } as React.CSSProperties}
            />
          );
        })}
      </div>
      <span className="fun-name">{m.name}</span>
    </div>
  );
}

function City(): React.JSX.Element {
  return (
    <div className="fun-city" style={{ minHeight: ROOM_H }}>
      <span className="fun-moon" aria-hidden="true" />
      <div className="fun-city-row">
        {TEAM.map((m, i) => (
          <Building key={m.id} m={m} i={i} />
        ))}
      </div>
      <div className="fun-street" />
    </div>
  );
}

export function FunOffice({ variant }: { variant: OfficeVariant }): React.JSX.Element {
  const play = usePlay();
  const scene =
    variant === OFFICE_VARIANT.TRACK ? (
      <Track />
    ) : variant === OFFICE_VARIANT.CITY ? (
      <City />
    ) : (
      <Garden />
    );
  return (
    <DetailPage frame={PAGE_FRAME.PAGE} title="Managers" width={PAGE_WIDTH.FULL}>
      <div className="fun-scene" data-play={play ? "true" : undefined}>
        {scene}
      </div>
    </DetailPage>
  );
}
