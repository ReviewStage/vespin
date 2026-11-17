import { RUN_PROFILE } from "@repo/host/app-state";
import { AdminDashboard } from "./AdminDashboard";
import { followAppTheme } from "./admin/admin-appearance";
import "./admin.css";
import { developmentFixtureProfile } from "./app/web-fixture";
import { mountPrerenderedPage } from "./mount-page";

// The admin wears the theme the app keeps, for as long as the page is open.
followAppTheme();

// A development tab's `?fixture=admin` stands the dashboard on staged answers with its admin signed in. Note that the
// check leads with Vite's `DEV`, which a production build replaces with `false`, so the branch and the fixture's chunk
// leave the bundle with it (`app/web-fixture.ts`).
if (import.meta.env.DEV && developmentFixtureProfile(location.search) === RUN_PROFILE.ADMIN) {
  void import("@repo/panel/admin/admin-fixture").then(({ ADMIN_FIXTURE }) =>
    mountPrerenderedPage(<AdminDashboard fixture={ADMIN_FIXTURE} />),
  );
} else {
  mountPrerenderedPage(<AdminDashboard />);
}
