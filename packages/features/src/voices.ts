/**
 * voices.ts -- every voice GPT-Live speaks with, what OpenAI publishes about each, and the one a call takes when nothing chose.
 *
 * The set is the API's, not ours: a voice outside it is refused when the
 * session is created, so offering one would be a control that cannot work. A
 * voice is chosen at creation and cannot change after the call starts, so a
 * changed setting is heard on the next call rather than this one. The voice
 * session route (`voice-wire.ts`) takes one, and the Voice settings page
 * offers them in `LIVE_VOICE_LIST`'s order.
 */

import { Schema } from "effect";

export const LIVE_VOICE = {
  ALLOY: "alloy",
  ASH: "ash",
  BALLAD: "ballad",
  BEACON: "beacon",
  BOSSA: "bossa",
  BRISE: "brise",
  CEDAR: "cedar",
  CINDER: "cinder",
  CORAL: "coral",
  DELTA: "delta",
  ECHO: "echo",
  FLITZ: "flitz",
  GLEAM: "gleam",
  HAREMA: "harema",
  JUNI: "juni",
  MARIN: "marin",
  MERIDIAN: "meridian",
  NIRA: "nira",
  NOEUL: "noeul",
  NURI: "nuri",
  QUARTZ: "quartz",
  RIPPLE: "ripple",
  SAGE: "sage",
  SHIDA: "shida",
  SHIMMER: "shimmer",
  SILLAGE: "sillage",
  STONE: "stone",
  TEMPO: "tempo",
  VERSE: "verse",
  VESPER: "vesper",
  WILLOW: "willow",
} as const;

export type LiveVoice = (typeof LIVE_VOICE)[keyof typeof LIVE_VOICE];

/** A voice the API offers, as a schema a wire value carrying one is declared with. */
export const LiveVoiceSchema = Schema.Literals(Object.values(LIVE_VOICE));

/** Settings offers the voices in this order. */
export const LIVE_VOICE_LIST: readonly LiveVoice[] = Object.values(LIVE_VOICE);

/**
 * The voice a call takes when nothing chose otherwise. `marin` is the API's
 * own default for GPT-Live, so a session that names no voice and one that
 * names this one sound the same.
 */
export const DEFAULT_LIVE_VOICE: LiveVoice = LIVE_VOICE.MARIN;

/** The language a voice is made to speak, as OpenAI's guide names it. */
export const LIVE_VOICE_LANGUAGE = {
  ENGLISH: "english",
  PORTUGUESE: "portuguese",
  FRENCH: "french",
  GERMAN: "german",
  HINDI: "hindi",
  JAPANESE: "japanese",
  KOREAN: "korean",
} as const;

export type LiveVoiceLanguage = (typeof LIVE_VOICE_LANGUAGE)[keyof typeof LIVE_VOICE_LANGUAGE];

/** The regional speaking style a voice carries, as OpenAI's guide names it. */
export const LIVE_VOICE_REGION = {
  NORTH_AMERICAN: "north-american",
  SOUTHERN_US: "southern-us",
  BRITISH: "british",
  IRISH: "irish",
  AUSTRALIAN: "australian",
  FILIPINO: "filipino",
  BRAZILIAN: "brazilian",
} as const;

export type LiveVoiceRegion = (typeof LIVE_VOICE_REGION)[keyof typeof LIVE_VOICE_REGION];

/** How a voice presents, as OpenAI's guide names it. */
export const LIVE_VOICE_PRESENTATION = {
  FEMININE: "feminine",
  MASCULINE: "masculine",
} as const;

export type LiveVoicePresentation =
  (typeof LIVE_VOICE_PRESENTATION)[keyof typeof LIVE_VOICE_PRESENTATION];

/** What OpenAI publishes about one voice: its language, and where it names them, its region and how it presents. */
export interface LiveVoiceProfile {
  readonly language: LiveVoiceLanguage;
  readonly region?: LiveVoiceRegion;
  readonly presentation?: LiveVoicePresentation;
}

const { ENGLISH, PORTUGUESE, FRENCH, GERMAN, HINDI, JAPANESE, KOREAN } = LIVE_VOICE_LANGUAGE;
const { FEMININE, MASCULINE } = LIVE_VOICE_PRESENTATION;

/**
 * Each voice as OpenAI describes it. The "Voice options" table of the GPT-Live
 * guide (developers.openai.com/api/docs/guides/live-conversations) covers the
 * voices GPT-Live added: language, regional influence, and presentation. The
 * earlier ten (alloy through verse, marin, and cedar) it leaves out, and
 * OpenAI says of them only that they "are currently optimized for English"
 * (the text-to-speech guide), so they stand as English with no region and no
 * presentation, rather than with one guessed at by ear.
 */
export const LIVE_VOICE_PROFILE = {
  alloy: { language: ENGLISH },
  ash: { language: ENGLISH },
  ballad: { language: ENGLISH },
  cedar: { language: ENGLISH },
  coral: { language: ENGLISH },
  echo: { language: ENGLISH },
  marin: { language: ENGLISH },
  sage: { language: ENGLISH },
  shimmer: { language: ENGLISH },
  verse: { language: ENGLISH },
  quartz: { language: ENGLISH, region: LIVE_VOICE_REGION.AUSTRALIAN, presentation: FEMININE },
  ripple: { language: ENGLISH, region: LIVE_VOICE_REGION.AUSTRALIAN, presentation: MASCULINE },
  vesper: { language: ENGLISH, region: LIVE_VOICE_REGION.BRITISH, presentation: MASCULINE },
  willow: { language: ENGLISH, region: LIVE_VOICE_REGION.IRISH, presentation: FEMININE },
  stone: { language: ENGLISH, region: LIVE_VOICE_REGION.IRISH, presentation: MASCULINE },
  gleam: { language: ENGLISH, region: LIVE_VOICE_REGION.NORTH_AMERICAN, presentation: FEMININE },
  meridian: {
    language: ENGLISH,
    region: LIVE_VOICE_REGION.NORTH_AMERICAN,
    presentation: MASCULINE,
  },
  bossa: { language: PORTUGUESE, region: LIVE_VOICE_REGION.BRAZILIAN, presentation: FEMININE },
  tempo: { language: PORTUGUESE, region: LIVE_VOICE_REGION.BRAZILIAN, presentation: MASCULINE },
  beacon: { language: ENGLISH, region: LIVE_VOICE_REGION.FILIPINO, presentation: MASCULINE },
  delta: { language: ENGLISH, region: LIVE_VOICE_REGION.SOUTHERN_US, presentation: FEMININE },
  cinder: { language: ENGLISH, region: LIVE_VOICE_REGION.SOUTHERN_US, presentation: MASCULINE },
  nuri: { language: GERMAN, presentation: FEMININE },
  juni: { language: GERMAN, presentation: FEMININE },
  flitz: { language: GERMAN, presentation: MASCULINE },
  brise: { language: FRENCH, presentation: FEMININE },
  sillage: { language: FRENCH, presentation: MASCULINE },
  nira: { language: HINDI, presentation: FEMININE },
  harema: { language: JAPANESE, presentation: FEMININE },
  shida: { language: JAPANESE, presentation: MASCULINE },
  noeul: { language: KOREAN, presentation: FEMININE },
} as const satisfies { readonly [Voice in LiveVoice]: LiveVoiceProfile };
