// metro.config.js -- Metro for the monorepo: a workspace package through its `exports`, a `.js` import onto the `.ts` beside it, and Sentry's debug ids in the bundle and its source maps.

const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const WORKSPACE_SCOPE = "@repo/";

/** The source a `.js` specifier may name, in the order Metro tries them. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js"];

/**
 * Every workspace package under `packages/`, by name: its folder and its
 * `exports` table. Read once when Metro starts, since the table is what
 * `packages/AGENTS.md` fixes: every door names `./src/<file>.js`, and the
 * file beside it is the `.ts`.
 */
function readWorkspacePackages() {
  const packages = new Map();
  const root = path.join(REPOSITORY_ROOT, "packages");

  for (const folder of fs.readdirSync(root)) {
    const manifestPath = path.join(root, folder, "package.json");

    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    packages.set(manifest.name, { directory: path.join(root, folder), exports: manifest.exports });
  }

  return packages;
}

/** The first source file `target` names once its `.js` is read as the `.ts` beside it, or undefined. */
function sourceFileFor(directory, target) {
  const stem = target.replace(/\.js$/u, "");

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path.join(directory, `${stem}${extension}`);

    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

/** The `exports` entry's file for one subpath, through its conditions where it has them. */
function exportTarget(exportsTable, subpath) {
  // oxlint-disable anti-slop/no-runtime-typeof -- Metro loads this CommonJS config before any bundle, so it reads a package's `exports` with no library to decode by
  const entry =
    typeof exportsTable === "string" && subpath === "." ? exportsTable : exportsTable?.[subpath];

  if (typeof entry === "string") return entry;

  if (entry && typeof entry === "object")
    return entry["react-native"] ?? entry.import ?? entry.default;
  // oxlint-enable anti-slop/no-runtime-typeof

  return undefined;
}

const workspacePackages = readWorkspacePackages();

/** Expo's default config, its resolver taught the workspace's packages. */
function workspaceConfig(projectRoot, options) {
  const config = getDefaultConfig(projectRoot, options);
  // Note that workspace packages are resolved here rather than by Metro's own
  // `exports` walk, because that walk takes an `exports` target literally and
  // `./src/index.js` is not a file in this repository: the packages are written
  // with `.js` specifiers naming the `.ts` beside them (`packages/AGENTS.md`),
  // which TypeScript, Vite, and esbuild each read that way and Metro does not.
  // A relative `./x.js` inside a package is read the same way once Metro has
  // failed to find the `.js` itself.
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.startsWith(WORKSPACE_SCOPE)) {
      const slash = moduleName.indexOf("/", WORKSPACE_SCOPE.length);
      const packageName = slash === -1 ? moduleName : moduleName.slice(0, slash);
      const subpath = slash === -1 ? "." : `.${moduleName.slice(slash)}`;
      const workspacePackage = workspacePackages.get(packageName);

      if (workspacePackage) {
        const target = exportTarget(workspacePackage.exports, subpath);
        const filePath = target && sourceFileFor(workspacePackage.directory, target);

        if (!filePath) {
          throw new Error(
            `${moduleName} is not a door of ${packageName}: its package.json exports no "${subpath}"`,
          );
        }

        return { type: "sourceFile", filePath };
      }
    }

    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch (error) {
      if (!moduleName.startsWith(".") || !moduleName.endsWith(".js")) throw error;
      const filePath = sourceFileFor(path.dirname(context.originModulePath), moduleName);

      if (!filePath) throw error;

      return { type: "sourceFile", filePath };
    }
  };

  return config;
}

// Note that the workspace's config is Sentry's base, rather than Sentry's
// wrapped around it, because Sentry's resolvers then fall back on the
// workspace's own; it writes a debug id into the bundle and its source map,
// which is what Sentry matches a Hermes stack trace to its uploaded map by.
// The SDK's web replay and feedback widget are left out of the bundle, and
// no options file is read, since the app passes its options to `init`.
module.exports = getSentryExpoConfig(__dirname, {
  getDefaultConfig: workspaceConfig,
  includeWebReplay: false,
  includeWebFeedback: false,
  injectReleaseForWeb: false,
  optionsFile: false,
});
