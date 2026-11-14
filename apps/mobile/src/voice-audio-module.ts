/**
 * voice-audio-module.ts -- the app's voice call audio module (`modules/voice-audio/`) as JavaScript reads it: a call's voice played from the speaker rather than the earpiece, or from headphones while any are connected.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, answers none and a call plays where WebRTC's
 * own audio session puts it.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class VoiceAudioModule extends NativeModule {
  /** Plays every call's voice from the speaker, where no headphones are connected, from the next time its audio starts. */
  preferSpeaker(): void;
}

/** The module, or none in a build without it. */
export const voiceAudioModule = requireOptionalNativeModule<VoiceAudioModule>("VoiceAudio");
