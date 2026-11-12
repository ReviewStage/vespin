// babel.config.js -- Expo's preset, with the one transform Hermes still needs over oRPC's parameters.

/** Whether a file is oRPC's, under `node_modules/@orpc/`. */
const ORPC_FILE = /node_modules[\\/]@orpc[\\/]/u;

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
    ],
  };
};
