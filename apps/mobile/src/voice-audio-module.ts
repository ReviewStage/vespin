/**
 * voice-audio-module.ts -- the app's voice call audio module (`modules/voice-audio/`) as JavaScript reads it: a call's voice played from the speaker rather than the earpiece, or from headphones while any are connected.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

declare class VoiceAudioModule extends NativeModule {
  /** Plays every call's voice from the speaker, where no headphones are connected, from the next time its audio starts. */
  preferSpeaker(): void;
}

/** The module. */
export const voiceAudioModule = requireNativeModule<VoiceAudioModule>("VoiceAudio");
