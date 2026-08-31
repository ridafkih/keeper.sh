const SERVER_CLOCK_REPAIR_PLAN_QUERY = `
  WITH defaulted AS (
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
      AND column_default LIKE 'now()%'
  ),
  anchored AS (
    SELECT table_name FROM defaulted WHERE column_name = 'createdAt'
  )
  SELECT
    format(
      'UPDATE %I SET %I = (%I AT TIME ZONE %L) AT TIME ZONE ''UTC'' WHERE %I IS NOT NULL',
      defaulted.table_name,
      defaulted.column_name,
      defaulted.column_name,
      $1::text,
      defaulted.column_name
    )
    || CASE
      WHEN defaulted.column_name = 'createdAt'
      THEN ''
      ELSE format(' AND %I = %I', defaulted.column_name, 'createdAt')
    END AS statement
  FROM defaulted
  JOIN anchored USING (table_name)
  ORDER BY
    defaulted.column_name = 'createdAt',
    defaulted.table_name,
    defaulted.column_name
`;

export { SERVER_CLOCK_REPAIR_PLAN_QUERY };
