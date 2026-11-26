/**
 * calm-office.tsx -- PROTOTYPE, throwaway: five calm ways to see your Managers, a face and one sentence each, built from @repo/ui alone.
 */

import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardPress,
  DetailPage,
  PAGE_FRAME,
  PAGE_WIDTH,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace, type ManagerFaceSize } from "@repo/ui/manager-face";
import { answerOf, type CalmManager, calmTeam, saidOf, sentenceOf } from "./calm-data.js";
import { OFFICE_SIZE, OFFICE_VARIANT, type OfficeVariant } from "./office-params.js";
import "./office.css";

const noop = () => {};
const ME = "Ada Lovelace";

function Face({ m, size }: { m: CalmManager; size: ManagerFaceSize }): React.JSX.Element {
  return <ManagerFace face={m.face} size={size} />;
}

/** A face and its name and line, the whole of it opening the Manager's chat. */
function Portrait({
  m,
  size,
  line = true,
}: {
  m: CalmManager;
  size: ManagerFaceSize;
  line?: boolean;
}): React.JSX.Element {
  return (
    <div className="calm-portrait" data-asks={m.ask === undefined ? undefined : "true"}>
      <Face m={m} size={size} />
      <Text variant={TEXT_VARIANT.LABEL}>{m.name}</Text>
      {line ? (
        <Text
          variant={TEXT_VARIANT.CAPTION}
          tone={m.ask === undefined ? TEXT_TONE.MUTED : TEXT_TONE.DEFAULT}
        >
          {sentenceOf(m)}
        </Text>
      ) : null}
      <CardPress onPress={noop} label={`Open ${m.name}'s chat`} />
    </div>
  );
}

/** Team photo: everyone in a row, the ones who need you standing in front, bigger. */
function TeamPhoto({ team }: { team: readonly CalmManager[] }): React.JSX.Element {
  const front = team.filter((m) => m.ask !== undefined);
  const back = team.filter((m) => m.ask === undefined);
  return (
    <div className="calm-photo">
      <div className="calm-photo-back">
        {back.map((m) => (
          <Portrait key={m.id} m={m} size={MANAGER_FACE_SIZE.PORTRAIT} />
        ))}
      </div>
      <div className="calm-photo-front">
        {front.map((m) => (
          <Portrait key={m.id} m={m} size={MANAGER_FACE_SIZE.HERO} />
        ))}
      </div>
    </div>
  );
}

/** Round table: the team seated around one table, you at its head, the ones who need you beside you. */
function RoundTable({ team }: { team: readonly CalmManager[] }): React.JSX.Element {
  // Note that the ones who need you take the seats nearest yours, at the table's foot, the rest going round from there.
  const seated = [...team].sort(
    (a, b) => Number(b.ask !== undefined) - Number(a.ask !== undefined),
  );
  const seats = seated.length;
  return (
    <div className="calm-table-room">
      <div className="calm-table">
        <div className="calm-table-top" />
        {seated.map((m, i) => {
          // Seats from just beside yours, alternating sides, round to the far end.
          const side = i % 2 === 0 ? 1 : -1;
          const step = Math.floor(i / 2) + 1;
          const angle = 90 + side * step * (300 / (seats + 1));
          const t = (angle * Math.PI) / 180;
          return (
            <div
              key={m.id}
              className="calm-seat"
              style={{
                left: `calc(50% + ${Math.cos(t).toFixed(3)} * var(--calm-rx))`,
                top: `calc(50% + ${Math.sin(t).toFixed(3)} * var(--calm-ry))`,
              }}
            >
              <Portrait m={m} size={MANAGER_FACE_SIZE.PORTRAIT} line={m.ask !== undefined} />
            </div>
          );
        })}
        <div
          className="calm-seat calm-seat-you"
          style={{ left: "50%", top: "calc(50% + var(--calm-ry) + 40px)" }}
        >
          <Avatar name={ME} size={AVATAR_SIZE.PORTRAIT} decorative />
          <Text variant={TEXT_VARIANT.LABEL}>You</Text>
        </div>
      </div>
      <div className="calm-table-asks">
        {seated
          .filter((m) => m.ask !== undefined)
          .map((m) => (
            <Text key={m.id} tone={TEXT_TONE.MUTED}>
              {saidOf(m)}
            </Text>
          ))}
      </div>
    </div>
  );
}

/** One sentence each: the team as a calm list of what each is saying, the ones that need you first. */
function Sentences({ team }: { team: readonly CalmManager[] }): React.JSX.Element {
  const ordered = [...team].sort(
    (a, b) => Number(b.ask !== undefined) - Number(a.ask !== undefined),
  );
  return (
    <div className="calm-sentences">
      {ordered.map((m) => (
        <div
          key={m.id}
          className="calm-sentence"
          data-asks={m.ask === undefined ? undefined : "true"}
        >
          <Face m={m} size={MANAGER_FACE_SIZE.MESSAGE} />
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.P}>
            {saidOf(m)}
          </Text>
          <CardPress onPress={noop} label={`Open ${m.name}'s chat`} />
        </div>
      ))}
    </div>
  );
}

/** Spotlight: only the ones who need you, big; everyone else folded into one quiet line. */
function Spotlight({ team }: { team: readonly CalmManager[] }): React.JSX.Element {
  const asking = team.filter((m) => m.ask !== undefined);
  const rest = team.filter((m) => m.ask === undefined);
  return (
    <div className="calm-spotlight">
      <div className="calm-spotlight-stage">
        {asking.map((m) => (
          <div key={m.id} className="calm-spot">
            <Face m={m} size={MANAGER_FACE_SIZE.HERO} />
            <Text variant={TEXT_VARIANT.SECTION}>{m.name}</Text>
            <Text tone={TEXT_TONE.MUTED}>{`Needs you to ${m.ask ?? ""}`}</Text>
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={noop}>
              Answer
            </Button>
          </div>
        ))}
      </div>
      <div className="calm-rest">
        <span className="calm-rest-faces">
          {rest.map((m) => (
            <Face key={m.id} m={m} size={MANAGER_FACE_SIZE.ROW} />
          ))}
        </span>
        <Text
          tone={TEXT_TONE.MUTED}
        >{`Everyone else is working · ${rest.map((m) => m.name).join(", ")}`}</Text>
        <CardPress onPress={noop} label="Show everyone" />
      </div>
    </div>
  );
}

/** Presence: a strip of faces over Home, one opened to its sentence as a click would. */
export function PresenceStrip(): React.JSX.Element {
  const team = calmTeam(OFFICE_SIZE);
  const opened = team.find((m) => m.ask !== undefined);
  return (
    <div className="calm-presence">
      <div className="calm-presence-row">
        {team.map((m) => (
          <div
            key={m.id}
            className="calm-presence-face"
            data-asks={m.ask === undefined ? undefined : "true"}
            data-open={m === opened ? "true" : undefined}
          >
            <Face m={m} size={MANAGER_FACE_SIZE.MESSAGE} />
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {m.name}
            </Text>
            <CardPress onPress={noop} label={`${m.name}: ${sentenceOf(m)}`} />
          </div>
        ))}
        <span className="calm-presence-answer">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {answerOf(team)}
          </Text>
        </span>
      </div>
      {opened === undefined ? null : (
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.COMPACT}>
          <div className="calm-presence-open">
            <Face m={opened} size={MANAGER_FACE_SIZE.MESSAGE} />
            <div className="calm-grow">
              <Text variant={TEXT_VARIANT.LABEL}>{opened.name}</Text>
              <Text tone={TEXT_TONE.MUTED}>{sentenceOf(opened)}</Text>
            </div>
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={noop}>
              Answer
            </Button>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={noop}>
              Open chat
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** The calm Office: its one answer as the title, then the idea. */
export function CalmOffice({ variant }: { variant: OfficeVariant }): React.JSX.Element {
  const team = calmTeam(OFFICE_SIZE);
  const answer = answerOf(team);
  const body =
    variant === OFFICE_VARIANT.PHOTO ? (
      <TeamPhoto team={team} />
    ) : variant === OFFICE_VARIANT.TABLE ? (
      <RoundTable team={team} />
    ) : variant === OFFICE_VARIANT.SPOTLIGHT ? (
      <Spotlight team={team} />
    ) : (
      <Sentences team={team} />
    );
  return (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      title={answer}
      description={variant === OFFICE_VARIANT.SPOTLIGHT ? undefined : "Your team"}
      width={PAGE_WIDTH.FULL}
    >
      {body}
    </DetailPage>
  );
}
