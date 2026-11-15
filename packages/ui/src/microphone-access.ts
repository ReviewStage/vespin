/**
 * microphone-access.ts -- what the controls that need the microphone say when it cannot be used.
 */

/** Why a dictated clip cannot run: it runs on the account's own OpenAI key, kept under Codex in Settings, and none is saved. */
export const OPENAI_KEY_MISSING_NOTE = "Add an OpenAI key in Settings";
