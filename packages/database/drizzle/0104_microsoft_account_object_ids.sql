DO $$
DECLARE
  microsoft_account RECORD;
  payload_segment text;
  object_id text;
BEGIN
  FOR microsoft_account IN
    SELECT "id", "idToken" FROM "account"
    WHERE "providerId" = 'microsoft' AND "idToken" IS NOT NULL
  LOOP
    BEGIN
      payload_segment := translate(split_part(microsoft_account."idToken", '.', 2), '-_', '+/');
      payload_segment := payload_segment || repeat('=', (4 - length(payload_segment) % 4) % 4);
      object_id := convert_from(decode(payload_segment, 'base64'), 'UTF8')::jsonb ->> 'oid';
      IF object_id IS NOT NULL AND length(trim(object_id)) > 0 THEN
        UPDATE "account" SET "accountId" = object_id WHERE "id" = microsoft_account."id";
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Microsoft account % has an unreadable id token', microsoft_account."id";
    END;
  END LOOP;
END $$;
