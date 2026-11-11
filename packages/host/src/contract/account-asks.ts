import {
  AGENT_CALL_FAILURE,
  chatGptDeviceLoginParamsSchema,
  chatGptDevicePollAnswerViewSchema,
  chatGptDeviceStartAnswerViewSchema,
  chatGptDeviceStartParamsSchema,
  chatGptDeviceWaitParamsSchema,
  dictationTranscribeAnswerViewSchema,
  dictationTranscribeParamsSchema,
  githubTokenAnswerViewSchema,
  githubTokenSaveParamsSchema,
  liveActivityEndedAnswerViewSchema,
  liveActivityEndedParamsSchema,
  liveActivityTokenAnswerViewSchema,
  liveActivityTokenParamsSchema,
  memoriesAnswerViewSchema,
  memoriesFollowParamsSchema,
  memoryForgetParamsSchema,
  providerKeyForAgentsParamsSchema,
  providerKeyRemoveParamsSchema,
  providerKeySaveParamsSchema,
  providerKeysAnswerViewSchema,
  pushDeviceDoneAnswerViewSchema,
  pushDeviceKeyParamsSchema,
  pushDeviceNotifyAnswerViewSchema,
  pushDeviceNotifyParamsSchema,
  pushDeviceRegisterParamsSchema,
  pushDeviceStatusAnswerViewSchema,
  soundAddAnswerViewSchema,
  soundAddParamsSchema,
  soundChoiceAnswerViewSchema,
  soundChoiceParamsSchema,
  soundClipAnswerViewSchema,
  soundIdParamsSchema,
  soundRenameParamsSchema,
  soundStateViewSchema,
  subscriptionLabelParamsSchema,
  subscriptionOrderParamsSchema,
} from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * account-asks.ts -- the account's own asks of the host from Settings and a dictating box, declared, and the live follows beside them.
 *
 * Only a panel draws Settings or records a clip, so every ask is the
 * panel's alone. A kind that carries nothing takes `undefined` alone, so a
 * window calls it with no payload and one sent anything is refused. A save's
 * key, a dictated clip, and a sound of the account's own each pass through to the host once
 * and are noted nowhere, and a refusal or a defect of the host's is drawn as the
 * coding-agent calls' unanswered failure. A workspace's memories, the account's provider keys, and its
 * GitHub token are live follows, each declared once (`live-follow.ts`).
 */

/** What the window draws for an ask the host could not answer. */
const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The account's plain asks, each answered by the agents' composer. */
export const ACCOUNT_ASK_ACTS = declaredActs({
  PROVIDER_KEYS_SAVE: hostAct({
    input: providerKeySaveParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't save your API key on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PROVIDER_KEYS_REMOVE: hostAct({
    input: providerKeyRemoveParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't remove your API key on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PROVIDER_KEYS_FOR_AGENTS: hostAct({
    input: providerKeyForAgentsParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't change your plan's default on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  SUBSCRIPTION_RENAME: hostAct({
    input: subscriptionLabelParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't rename your plan on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  SUBSCRIPTIONS_REORDER: hostAct({
    input: subscriptionOrderParamsSchema,
    output: providerKeysAnswerViewSchema,
    refusal: "Couldn't reorder your plans on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_START: hostAct({
    input: chatGptDeviceStartParamsSchema,
    output: chatGptDeviceStartAnswerViewSchema,
    refusal: "Couldn't start connecting Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_WAIT: hostAct({
    input: chatGptDeviceWaitParamsSchema,
    output: chatGptDevicePollAnswerViewSchema,
    refusal: "Couldn't wait for Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  CHATGPT_DEVICE_CANCEL: hostAct({
    input: chatGptDeviceLoginParamsSchema,
    output: chatGptDevicePollAnswerViewSchema,
    refusal: "Couldn't stop connecting Codex on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  GITHUB_TOKEN_SAVE: hostAct({
    input: githubTokenSaveParamsSchema,
    output: githubTokenAnswerViewSchema,
    refusal: "Could not save your GitHub token on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  GITHUB_TOKEN_REMOVE: hostAct({
    input: EffectSchema.Undefined,
    output: githubTokenAnswerViewSchema,
    refusal: "Could not remove your GitHub token on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  MEMORIES_FORGET: hostAct({
    input: memoryForgetParamsSchema,
    output: memoriesAnswerViewSchema,
    refusal: "Could not forget that memory on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  SOUND_READ: hostAct({
    input: soundIdParamsSchema,
    output: soundClipAnswerViewSchema,
    refusal: "Could not read your sound on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: UNANSWERED,
  }),
  SOUND_ADD: hostAct({
    input: soundAddParamsSchema,
    output: soundAddAnswerViewSchema,
    refusal: "Could not add your sound on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  SOUND_RENAME: hostAct({
    input: soundRenameParamsSchema,
    output: soundStateViewSchema,
    refusal: "Could not rename your sound on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  SOUND_REMOVE: hostAct({
    input: soundIdParamsSchema,
    output: soundStateViewSchema,
    refusal: "Could not remove your sound on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  SOUND_CHOOSE: hostAct({
    input: soundChoiceParamsSchema,
    output: soundChoiceAnswerViewSchema,
    refusal: "Could not choose your sound on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  DICTATION_TRANSCRIBE: hostAct({
    input: dictationTranscribeParamsSchema,
    output: dictationTranscribeAnswerViewSchema,
    refusal: "Could not transcribe the recording on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  ACCOUNT_ACTIVE: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not tell the service you are here on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: undefined,
  }),
  PUSH_DEVICE_REGISTER: hostAct({
    input: pushDeviceRegisterParamsSchema,
    output: pushDeviceDoneAnswerViewSchema,
    refusal: "Could not register this phone for notifications.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PUSH_DEVICE_UNREGISTER: hostAct({
    input: pushDeviceKeyParamsSchema,
    output: pushDeviceDoneAnswerViewSchema,
    refusal: "Could not unregister this phone from notifications.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PUSH_DEVICE_STATUS: hostAct({
    input: pushDeviceKeyParamsSchema,
    output: pushDeviceStatusAnswerViewSchema,
    refusal: "Could not read this phone's notifications.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  PUSH_DEVICE_NOTIFY: hostAct({
    input: pushDeviceNotifyParamsSchema,
    output: pushDeviceNotifyAnswerViewSchema,
    refusal: "Could not change when this phone is notified.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  LIVE_ACTIVITY_START_TOKEN: hostAct({
    input: liveActivityTokenParamsSchema,
    output: liveActivityTokenAnswerViewSchema,
    refusal: "Could not register this phone for running agents on the Lock Screen.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  LIVE_ACTIVITY_TOKEN: hostAct({
    input: liveActivityTokenParamsSchema,
    output: liveActivityTokenAnswerViewSchema,
    refusal: "Could not register this phone's running agents on the Lock Screen.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  LIVE_ACTIVITY_ENDED: hostAct({
    input: liveActivityEndedParamsSchema,
    output: liveActivityEndedAnswerViewSchema,
    refusal: "Could not tell the service the running agents left the Lock Screen.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
});

/** A workspace's memories, followed for Settings › Memory while it holds them, and the account's provider keys and GitHub token, each held once for the account signed in while Settings draws them. */
export const ACCOUNT_ASK_FOLLOWS = liveFollows({
  MEMORIES_FOLLOW: liveFollow({
    slice: LIVE_READ.MEMORIES,
    hold: HOLD.WINDOW,
    key: memoriesFollowParamsSchema,
    refusal: "Could not follow the workspace's memory on this system.",
    panelOnly: true,
    retry: {
      name: "MEMORIES_RETRY",
      refusal: "Could not read the workspace's memory again on this system.",
    },
  }),
  PROVIDER_KEYS_FOLLOW: liveFollow({
    slice: LIVE_READ.PROVIDER_KEYS,
    hold: HOLD.ACCOUNT,
    refusal: "Couldn't follow your API keys on this system.",
    panelOnly: true,
    retry: {
      name: "PROVIDER_KEYS_RETRY",
      refusal: "Couldn't read your API keys again on this system.",
    },
  }),
  GITHUB_TOKEN_FOLLOW: liveFollow({
    slice: LIVE_READ.GITHUB_TOKEN,
    hold: HOLD.ACCOUNT,
    refusal: "Could not follow your GitHub token on this system.",
    panelOnly: true,
    retry: {
      name: "GITHUB_TOKEN_RETRY",
      refusal: "Could not read your GitHub token again on this system.",
    },
  }),
});

export const accountAskActsContract = {
  ...contractOf(ACCOUNT_ASK_ACTS),
  ...followsContractOf(ACCOUNT_ASK_FOLLOWS),
};
