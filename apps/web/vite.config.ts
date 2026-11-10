import { fileURLToPath } from "node:url";
import { PANEL_ASSET_BASE } from "@repo/features/link-home";
import { PAGE_IN_MAC_APP_PATH } from "@repo/features/page-frame";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { panelBuild } from "./scripts/panel-build";
import { siteMarkdown } from "./scripts/site-markdown";

const resolveEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// What the web app's tab reads of the deployment it was built for, from the
// build's environment as the desktop's build reads its own: Vercel's name for
// the deployment, which only `production` records session replay under
// (`src/app/web-session-replay.ts`) and Sentry files reports under, and the
// DSN and commit the tab reports to Sentry with (`src/app/web-sentry.ts`). A
// build without `SENTRY_DSN` writes an empty one, and the tab loads no SDK.
const WEB_DEPLOYMENT_DEFINES = {
  WEB_DEPLOYMENT: JSON.stringify(process.env.VERCEL_ENV ?? ""),
  WEB_SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN ?? ""),
  WEB_SENTRY_RELEASE: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
};

/**
 * The page a frame shows where the deployment has no sandbox, served in
 * development at its clean path as the root `vercel.json` serves it. Note
 * that Vite already serves every entry page at its clean path, but not a page
 * `public/` carries, which this one is.
 */
/** The page the Inbox threads prototype's long ask links: the expired-invite page's two layouts over the invite funnel. */
const PROTO_PAGE = [
  "<!doctype html><html><head><meta charset='utf-8'><title>Invite funnel</title><style>",
  "body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2328;background:#fff}",
  "h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}p{margin:0 0 8px;color:#57606a}",
  ".row{display:flex;gap:16px;flex-wrap:wrap}.box{flex:1;min-width:220px;border:1px solid #d0d7de;border-radius:10px;padding:16px}",
  ".face{display:flex;align-items:center;gap:10px;margin-bottom:10px}.dot{width:32px;height:32px;border-radius:50%;background:#8b5cf6;color:#fff;display:grid;place-items:center;font-weight:600}",
  ".btn{display:inline-block;margin-top:10px;padding:6px 12px;border-radius:8px;background:#1f2328;color:#fff;font-size:13px}.link{color:#0969da}",
  "table{border-collapse:collapse;margin-top:8px}td,th{padding:6px 12px;border-bottom:1px solid #d0d7de;text-align:left}td:last-child{text-align:right}",
  "</style></head><body><h1>Expired-invite page: two layouts</h1><p>What a teammate sees when their invite link has expired.</p>",
  "<div class='row'><div class='box'><b>A · Card</b><div class='face'><div class='dot'>M</div><div><div><b>Maya Chen</b></div><div style='color:#57606a'>invited you to Acme</div></div></div>",
  "<div>Maya's invite to Acme has expired.</div><span class='btn'>Ask Maya for a new invite</span></div>",
  "<div class='box'><b>B · Plain</b><p style='margin-top:10px;color:#1f2328'>This invite has expired.</p><span class='link'>Back to sign in</span></div></div>",
  "<h2>Invite funnel, last 7 days</h2><table><tr><th>Step</th><th>Invites</th></tr><tr><td>Sent</td><td>120</td></tr><tr><td>Opened</td><td>94</td></tr>",
  "<tr><td>Accepted</td><td>71</td></tr><tr><td>Expired</td><td>9</td></tr></table></body></html>",
].join("");

function pageInMacAppAtCleanPath(): Plugin {
  return {
    name: "page-in-mac-app-at-clean-path",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === PAGE_IN_MAC_APP_PATH)
          request.url = `${url.pathname}.html${url.search}`;
        // Note that the Inbox threads prototype serves the fixture workspace's places at their own paths in development, so a link to one opens it.
        else if (url.pathname.startsWith("/personal")) request.url = `/app.html${url.search}`;
        // And a page frame the fixture's agent showed, which only the service serves otherwise.
        else if (/^\/api\/plans\/[^/]+\/pages\/[^/]+\/versions\/\d+\/frame$/u.test(url.pathname)) {
          _response.setHeader("content-type", "text/html; charset=utf-8");
          _response.end(PROTO_PAGE);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: WEB_DEPLOYMENT_DEFINES,
  plugins: [
    react(),
    tailwindcss(),
    ...panelBuild(PANEL_ASSET_BASE),
    siteMarkdown(),
    pageInMacAppAtCleanPath(),
  ],
  build: {
    // Vite's own gzip report is only a cost to every build.
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        main: resolveEntry("./index.html"),
        about: resolveEntry("./about.html"),
        privacy: resolveEntry("./privacy.html"),
        changelog: resolveEntry("./changelog.html"),
        "sign-in": resolveEntry("./sign-in.html"),
        consent: resolveEntry("./consent.html"),
        "github-installed": resolveEntry("./github-installed.html"),
        "integration-connected": resolveEntry("./integration-connected.html"),
        admin: resolveEntry("./admin.html"),
        "connect-github": resolveEntry("./connect-github.html"),
        "accept-invitation": resolveEntry("./accept-invitation.html"),
        "desktop-session": resolveEntry("./desktop-session.html"),
        app: resolveEntry("./app.html"),
        "404": resolveEntry("./404.html"),
      },
    },
  },
});
