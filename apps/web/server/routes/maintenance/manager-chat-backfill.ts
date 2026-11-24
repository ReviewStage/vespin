import { managerChatBackfillApp } from "@repo/service/maintenance/manager-chat-backfill-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The one-time backfill of every Manager's chat from its transcript, asked
 * by hand under the deployment's `CRON_SECRET`
 * (`scripts/backfill-manager-chats.sh`). The logic lives in
 * `packages/service/src/maintenance/manager-chat-backfill.ts`, behind the
 * group in `packages/service/src/maintenance/manager-chat-backfill-app.ts`;
 * this file only hands the group's export to the route adaptor.
 */
export default routeFromHttpRouter(managerChatBackfillApp());
