// sign-in.tsx -- the sign-in screen: the Keel mark on the brand's ground and a way in through Google and through GitHub at its foot, each in the system's authentication session.

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@repo/credentials/snapshot";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { SIGN_IN_FAILURE, SIGN_IN_FAILURE_WORDS, type SignInFailure } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { AuthPage, PROVIDER_MARK_ASSET, ProviderButton, Screen } from "@repo/ui-native";
import { useState } from "react";
import { noteSignedIn } from "../../app-ready.js";
import { reportSignInEnd, SIGN_IN_END } from "../../crash-reports.js";
import { useHostActs } from "../../host/host-provider.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The ways in, in the web's order, each with the provider's mark as the web's buttons carry it. */
const WAYS_IN = [
  { provider: ACCOUNT_PROVIDER.GOOGLE, mark: PROVIDER_MARK_ASSET.GOOGLE },
  { provider: ACCOUNT_PROVIDER.GITHUB, mark: PROVIDER_MARK_ASSET.GITHUB },
] as const;

/**
 * Each press asks the host to sign in through that provider, which shows the
 * provider's page in the system's sheet; the screen gives way to the Inbox
 * once the account lands (`_layout.tsx`'s guard). A sheet closed by hand is
 * an ordinary end and says nothing; any other end says why in the web's
 * words. Every end without an account is reported (`crash-reports.ts`), a
 * closed sheet among them, since a sheet that never caught its return closes
 * the same way.
 */
export default function SignInScreen() {
  const acts = useHostActs();
  const [opening, setOpening] = useState<AccountProvider | undefined>(undefined);
  const [failure, setFailure] = useState<SignInFailure | undefined>(undefined);

  const signIn = (provider: AccountProvider) => {
    setOpening(provider);
    setFailure(undefined);
    acts[ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]({ provider })
      .then(
        (answer) => {
          if ("failure" in answer) {
            reportSignInEnd(provider, answer.failure);
            setFailure(answer.failure);

            return;
          }

          if (answer.account.status !== ACCOUNT_STATUS.SIGNED_IN) {
            reportSignInEnd(provider, SIGN_IN_END.CLOSED);

            return;
          }

          noteSignedIn();
        },
        (refusal) => {
          reportSignInEnd(
            provider,
            SIGN_IN_FAILURE.UNFINISHED,
            refusal instanceof Error ? refusal : undefined,
          );
          setFailure(SIGN_IN_FAILURE.UNFINISHED);
        },
      )
      .finally(() => setOpening(undefined));
  };

  return (
    <Screen>
      <AuthPage
        title={`Sign in to ${PRODUCT_NAME}`}
        error={failure === undefined ? undefined : SIGN_IN_FAILURE_WORDS[failure]}
      >
        {WAYS_IN.map(({ provider, mark }) => (
          <ProviderButton
            key={provider}
            label={`${opening === provider ? "Opening" : "Continue with"} ${SOCIAL_PROVIDER_LABEL[provider]}`}
            mark={mark}
            disabled={opening !== undefined}
            onPress={() => signIn(provider)}
          />
        ))}
      </AuthPage>
    </Screen>
  );
}
