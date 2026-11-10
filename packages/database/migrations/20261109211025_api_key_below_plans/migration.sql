-- Each provider's API key now stands in one order with its plans, which pays first to last.
-- A key paid only once every plan was at its limit, so it moves below its provider's plans.
UPDATE "account_provider_key" AS "key"
SET "position" = "plans"."bottom"
FROM (
  SELECT "user_id", "provider", MAX("position") + 1 AS "bottom"
  FROM "account_provider_key"
  WHERE "kind" <> 'api_key'
  GROUP BY "user_id", "provider"
) AS "plans"
WHERE "key"."kind" = 'api_key'
  AND "key"."user_id" = "plans"."user_id"
  AND "key"."provider" = "plans"."provider";
