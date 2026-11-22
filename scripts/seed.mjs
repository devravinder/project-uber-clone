import { call, main, parseArgs, requireUp } from "./lib.mjs";

const options = parseArgs(process.argv.slice(2), { riders: 20, drivers: 50 });

await main(async () => {
  await requireUp("rider", "driver");
  const riders = await call("rider", "/admin/seed", {
    method: "POST",
    body: { count: options.riders, prefix: "r" },
  });
  const drivers = await call("driver", "/admin/seed", {
    method: "POST",
    body: { count: options.drivers, prefix: "d" },
  });
  console.log(`riders r001..: ${riders.body.created} new, ${riders.body.total} in total`);
  console.log(`drivers d001..: ${drivers.body.created} new, ${drivers.body.total} in total`);
});
