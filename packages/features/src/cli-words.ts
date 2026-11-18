// cli-words.ts -- what Settings says of the command-line tool: how to install it and sign it in, its sign-in, and Sign out everywhere, on the desktop, the web, and the iOS app alike.

import { MCP_ACCESS_TOKEN_MINUTES } from "./mcp-client-wire.js";
import { PRODUCT_NAME } from "./product-name.js";

/** What the CLI section and its rows say. */
export const CLI_WORDS = {
  TITLE: "CLI",
  CAPTION: `Use ${PRODUCT_NAME} from your terminal.`,
  INSTALL_LABEL: `Install the ${PRODUCT_NAME.toLowerCase()} command`,
  INSTALL_NPM: "With npm, on Node 20 or later.",
  SIGN_IN_LABEL: "Sign in from your terminal",
  SIGN_IN_WORDS: "It opens your browser to sign in.",
  SIGNED_IN: "Signed in",
  SIGN_OUT: "Sign out everywhere",
  SIGNING_OUT: "Signing out",
  SIGN_OUT_REFUSED: "Signing out didn't finish. Try again.",
  READ_FAILED: "The command's sign-in could not be read.",
  NOT_SIGNED_IN: "Not signed in yet.",
} as const;

/** The question Sign out everywhere asks before it revokes the command's sign-in on every computer. */
export const CLI_SIGN_OUT_QUESTION = {
  title: `Sign out of the ${PRODUCT_NAME.toLowerCase()} command everywhere?`,
  body: `It signs out on every computer it's signed in on. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
  verb: CLI_WORDS.SIGN_OUT,
} as const;
