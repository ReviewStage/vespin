import { startSiteAnalytics } from "./analytics";
import { GUIDES, GuidesPage } from "./GuidesPage";
import { GUIDES_PATH, guideViewForPath } from "./guides";
import { mountPrerenderedPage } from "./mount-page";
import "./styles.css";

startSiteAnalytics();

/* Every guides address is served from a file the prerender wrote for it, so
   the address names the view that file holds; hydration must draw the same
   one. An address it has no view for only reaches here from the dev server,
   which serves the source page wherever it is asked. */
const view =
  guideViewForPath(GUIDES, window.location.pathname) ?? guideViewForPath(GUIDES, GUIDES_PATH);

if (view === undefined) throw new Error("The guides have no index");

mountPrerenderedPage(<GuidesPage view={view} />);
