// babel.config.js -- Expo's preset, with the one transform Hermes still needs over oRPC's parameters, and Mermaid's one-file build read as its words.

/** Whether a file is oRPC's, under `node_modules/@orpc/`. */
const ORPC_FILE = /node_modules[\\/]@orpc[\\/]/u;

/** Mermaid's one-file build, which the app never runs, only hands to the diagrams' sealed page (`@repo/ui-native`'s `diagram.tsx`). */
const SOURCE_TEXT_FILE = /node_modules[\\/]mermaid[\\/]dist[\\/]mermaid\.min\.js$/u;

/** A character past ASCII, by its UTF-16 unit. */
const PAST_ASCII = /[\u0080-￿]/gu;

/** Code with each character past ASCII written as its `\uXXXX` escape, which the code reads as the same character. */
function asciiOnly(code) {
  return code.replace(
    PAST_ASCII,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Reads a file as a module whose value is its words: its words are parsed
 * as one string rather than as code, so the 3.6 MB build is never parsed
 * as JavaScript, never runs on Hermes, which has no DOM for it, and stands
 * in the bundle as one string. Note that each character past ASCII is
 * escaped first, because Hermes keeps a string holding any such character
 * in two bytes to each, which doubled the build's place in the bundle; the
 * few in Mermaid's build all stand in its regular expressions, where an
 * escape names the same character.
 */
function sourceText() {
  return {
    parserOverride: (code, options, parse) =>
      parse(`module.exports = ${JSON.stringify(asciiOnly(code))};`, options),
  };
}

/**
 * The preset leaves parameters alone under Hermes, which handles them, but
 * Hermes's parser refuses a rest parameter that destructures
 * (`async (...[input, options]) =>`), which `@orpc/server`'s `call` is
 * written with, so that one transform runs over oRPC alone. Note that the
 * test is a function, because Metro reads this config once with no file to
 * name, for its cache key, and Babel refuses a pattern there.
 */
module.exports = (api) => {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    overrides: [
      {
        test: (filename) => filename !== undefined && ORPC_FILE.test(filename),
        plugins: ["@babel/plugin-transform-parameters"],
      },
      {
        test: (filename) => filename !== undefined && SOURCE_TEXT_FILE.test(filename),
        plugins: [sourceText],
      },
    ],
  };
};
