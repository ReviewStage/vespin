// use-survey.ts -- setup's survey answers as the phone holds them until they are kept on the account (`APP_SETTING_SCHEMA.onboardingSurvey`), as the panel's `useSurvey` holds them.

import { ACT_KIND } from "@repo/host/acts";
import { selectAppSettingsView } from "@repo/host/app-state-reads";
import {
  APP_SETTING_SCHEMA,
  type OnboardingSurvey,
  onboardingSurveyFrom,
  onboardingSurveyStored,
  type SurveyDraft,
  sameSurveyAnswers,
  surveyDraftAnswered,
  surveyKept,
} from "@repo/settings";
import { actionRefused } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** The survey as its step holds it. */
export interface Survey {
  readonly answers: SurveyDraft;
  /** Whether any question is answered, which turns the step's Skip into Continue. */
  readonly answered: boolean;
  readonly answer: (change: SurveyDraft) => void;
  /** Keeps the answers on the account, none among them where every pick was taken back, unless they stand there already. */
  readonly keep: () => void;
}

/**
 * The survey's answers: the account's until a pick here, so setup on
 * another device opens on them. A walk back and forth keeps them again only
 * where they changed, and answers all taken back are kept too, as none, so
 * the account's earlier answers do not come back; a survey never answered
 * keeps nothing. A keep refused is said in the failure notice and kept
 * again on the next Continue.
 */
export function useSurvey(): Survey {
  const acts = useHostActs();
  const write = useWrite();

  const stored = onboardingSurveyFrom(
    useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.onboardingSurvey,
  );

  const [draft, setDraft] = useState<SurveyDraft>();
  const saving = useRef<OnboardingSurvey | undefined>(undefined);
  const answers = draft ?? stored ?? {};
  const answered = surveyDraftAnswered(answers);

  const keep = () => {
    if (!answered && (saving.current ?? stored) === undefined) return;
    const keeping = surveyKept(answers);

    if (sameSurveyAnswers(saving.current ?? stored, keeping)) return;
    saving.current = keeping;
    void write(
      () =>
        acts[ACT_KIND.SETTING_UPDATE]({
          field: APP_SETTING_SCHEMA.onboardingSurvey.field,
          value: onboardingSurveyStored(keeping),
        }),
      { refused: actionRefused },
    ).then((went) => {
      // A keep refused leaves the answers to be kept again on the next Continue.
      if (!went && saving.current === keeping) saving.current = undefined;
    });
  };

  return {
    answers,
    answered,
    answer: (change) => setDraft({ ...answers, ...change }),
    keep,
  };
}
