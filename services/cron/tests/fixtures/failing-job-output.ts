import { createDatabase } from "@keeper.sh/database";
import { sql } from "drizzle-orm";
import { baker } from "../../src/utils/baker";
import { destroy } from "../../src/utils/logging";
import { registerJobs } from "../../src/utils/register-jobs";
import { withCronWideEvent } from "../../src/utils/with-wide-event";

const email = process.env.PROBE_EMAIL ?? "";

const database = await createDatabase(process.env.KEEPER_TEST_DATABASE_URL ?? "", {
  maxConnections: 1,
});

await database.execute(sql`create temp table job_accounts (email text unique not null)`);
await database.execute(sql`insert into job_accounts values (${email})`);

const insertDuplicateAccount = async (): Promise<void> => {
  await database.execute(sql`insert into job_accounts values (${email})`);
};

const [job] = registerJobs([
  withCronWideEvent({
    callback: insertDuplicateAccount,
    cron: "@every_minute",
    immediate: true,
    name: "failing-job",
  }),
]);

while (job?.getMetrics().totalExecutions === 0) {
  await Bun.sleep(10);
}

baker.stopAll();
destroy();

await insertDuplicateAccount();
