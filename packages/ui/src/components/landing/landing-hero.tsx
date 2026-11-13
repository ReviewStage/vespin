import { TASK_STATUS } from "@repo/features/task-wire";
import { type ReactNode, useRef, useState } from "react";
import {
  DESKTOP_PLACE,
  type DesktopPlace,
  DesktopSidebar,
  type SidebarGo,
} from "./landing-desktop.js";
import {
  type AnswerDrive,
  AutomationPage,
  BEAT,
  DesktopWindow,
  type Draft,
  type InboxItem,
  InboxPage,
  ItemThread,
  type OpenThread,
  OTHER_ITEMS,
  QUESTION,
  QuestionThread,
  QuietTaskPage,
  questionItem,
  type Said,
  STORY,
  TaskPage,
  ThreadPath,
} from "./landing-scenes.js";
import { useStory } from "./landing-story.js";

/**
 * landing-hero.tsx -- the hero's app: the Mac app's window, live, which a reader clicks through as they would the app itself.
 *
 * It is drawn from the scenes' own pages (`landing-scenes.tsx`), but where a
 * scene plays a story on a clock, this window waits on the reader: the
 * sidebar goes between the Inbox, Automations, and My tasks; an Inbox item
 * opens its thread; the agent's question takes an option and a note and is
 * sent, settling its row; any other thread takes a reply, and a task a
 * follow-up. The task with a story of its own plays it once as it opens.
 * Nothing leaves the page: every word typed stays in this window's state.
 */

/** The task whose page plays the agents' story as it opens. */
const STORY_TASK = "invites";

/** What each other task shows: the agent at work on it, if any, and its last words, or the empty log's. */
const QUIET_TASKS: ReadonlyMap<string, { readonly agent: string | null; readonly words: string }> =
  new Map([
    [
      "digest",
      {
        agent: "Digest template",
        words:
          "The template renders the week's merged pull requests and finished tasks. I'll send a test once the sender domain is verified.",
      },
    ],
    [
      "export",
      { agent: null, words: "No agent has started on this task yet. Describe it to start one." },
    ],
  ]);

/** The window's page: the Inbox, Automations, or one of My tasks. */
type View =
  | { readonly place: typeof DESKTOP_PLACE.INBOX }
  | { readonly place: typeof DESKTOP_PLACE.AUTOMATIONS }
  | { readonly place: typeof DESKTOP_PLACE.TASK; readonly task: string };

/** The reader's answer to the agent's question: the option picked, the note, and whether it was sent. */
type Answer = { readonly pick: string | null; readonly note: string; readonly sent: boolean };

/** Everything sent somewhere, by where: an Inbox item's id or a task's. */
type Sent = ReadonlyMap<string, readonly Said[]>;

/** `map` with `key` set to `value`. */
function withEntry<Value>(
  map: ReadonlyMap<string, Value>,
  key: string,
  value: Value,
): ReadonlyMap<string, Value> {
  return new Map(map).set(key, value);
}

/** The words, replies, and follow-ups the reader writes, and the draft box for any place they write to. */
function useWrites() {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [sent, setSent] = useState<Sent>(new Map());
  const nextId = useRef(0);

  const draft = (key: string): Draft => {
    const words = drafts.get(key) ?? "";

    return {
      words,
      onWords: (next) => setDrafts((all) => withEntry(all, key, next)),
      onSend: () => {
        const trimmed = words.trim();

        if (trimmed === "") return;
        nextId.current += 1;
        const said = { id: nextId.current, words: trimmed };
        setSent((all) => withEntry(all, key, [...(all.get(key) ?? []), said]));
        setDrafts((all) => withEntry(all, key, ""));
      },
    };
  };

  return { draft, sent: (key: string): readonly Said[] => sent.get(key) ?? [] };
}

/** The task's page that plays the agents' story once, from its start, as it opens. */
function StoryTask({
  sidebar,
  followUp,
  sent,
}: {
  sidebar: ReactNode;
  followUp: Draft;
  sent: readonly Said[];
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStory(ref, STORY.AGENTS.LAST + 1, BEAT.AGENTS, { once: true });

  return (
    <div ref={ref} className="ui-landing-hero-page">
      <TaskPage step={step} sidebar={sidebar} followUp={followUp} sent={sent} />
    </div>
  );
}

/** The automation's page, its run firing once as it opens. */
function LiveAutomation({ sidebar }: { sidebar: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStory(ref, 5, BEAT.RUNS, { once: true });

  return (
    <div ref={ref} className="ui-landing-hero-page">
      <AutomationPage step={step} sidebar={sidebar} />
    </div>
  );
}

/** The Inbox's rows as the reader has left them: the question settled once answered, the open one current. */
function heroItems(answer: Answer, open: string | null): readonly InboxItem[] {
  return [
    questionItem({
      answer: answer.sent ? answer.pick : null,
      unread: false,
      current: open === QUESTION.ID,
    }),
    ...OTHER_ITEMS.map((item) => ({ ...item, current: item.id === open })),
  ];
}

/** The live Mac app the hero shows, opened on the agent's question waiting in the Inbox. */
export function LandingHeroApp(): React.JSX.Element {
  const [view, setView] = useState<View>({ place: DESKTOP_PLACE.INBOX });
  const [openItem, setOpenItem] = useState<string | null>(QUESTION.ID);
  const [answer, setAnswer] = useState<Answer>({ pick: null, note: "", sent: false });
  const writes = useWrites();

  const go: SidebarGo = {
    place: (place: DesktopPlace) =>
      setView(
        place === DESKTOP_PLACE.AUTOMATIONS
          ? { place: DESKTOP_PLACE.AUTOMATIONS }
          : { place: DESKTOP_PLACE.INBOX },
      ),
    task: (task) => setView({ place: DESKTOP_PLACE.TASK, task }),
  };

  const sidebar = (
    <DesktopSidebar
      place={view.place}
      openTask={view.place === DESKTOP_PLACE.TASK ? view.task : undefined}
      needYou={answer.sent ? 1 : 2}
      go={go}
    />
  );

  const drive: AnswerDrive = {
    onPick: (pick) => setAnswer((now) => ({ ...now, pick })),
    onNote: (note) => setAnswer((now) => ({ ...now, note })),
    onSend: () => setAnswer((now) => ({ ...now, note: now.note.trim(), sent: true })),
  };

  const openThread = (): OpenThread | null => {
    if (openItem === QUESTION.ID) {
      return {
        path: (
          <ThreadPath
            task={QUESTION.TASK}
            status={TASK_STATUS.IN_PROGRESS}
            agent={QUESTION.AGENT}
          />
        ),
        thread: (
          <QuestionThread pick={answer.pick} note={answer.note} sent={answer.sent} drive={drive} />
        ),
      };
    }

    const item = OTHER_ITEMS.find((other) => other.id === openItem);

    if (item === undefined) return null;

    return {
      path: <ThreadPath task={item.task} status={item.status} agent={item.agent} />,
      thread: (
        <ItemThread
          key={item.id}
          item={item}
          replies={writes.sent(item.id)}
          reply={writes.draft(item.id)}
        />
      ),
    };
  };

  const page = (): ReactNode => {
    switch (view.place) {
      case DESKTOP_PLACE.INBOX:
        return (
          <InboxPage
            sidebar={sidebar}
            items={heroItems(answer, openItem)}
            open={openThread()}
            onOpen={setOpenItem}
          />
        );
      case DESKTOP_PLACE.AUTOMATIONS:
        return <LiveAutomation sidebar={sidebar} />;
      case DESKTOP_PLACE.TASK: {
        const quiet = QUIET_TASKS.get(view.task);

        if (view.task === STORY_TASK || quiet === undefined) {
          return (
            <StoryTask
              sidebar={sidebar}
              followUp={writes.draft(STORY_TASK)}
              sent={writes.sent(STORY_TASK)}
            />
          );
        }

        return (
          <QuietTaskPage
            key={view.task}
            sidebar={sidebar}
            agent={quiet.agent}
            words={quiet.words}
            sent={writes.sent(view.task)}
            followUp={writes.draft(view.task)}
          />
        );
      }
    }
  };

  return (
    <DesktopWindow label="The Mac app, live: click through it" live>
      {page()}
    </DesktopWindow>
  );
}
