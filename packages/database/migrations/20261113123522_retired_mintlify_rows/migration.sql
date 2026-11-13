-- Mintlify was offered as an integration (#8690) and withdrawn (#8733), which left the
-- rows a sign-in to it began naming a provider no build offers any longer.
DELETE FROM "integration_connection" WHERE "provider" = 'mintlify';
