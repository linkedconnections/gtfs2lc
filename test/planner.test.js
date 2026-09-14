const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

test("browser planner and worker integration", async () => {
  const run = promisify(execFile);
  await run(process.execPath, [
    "--test",
    path.join(__dirname, "planner-cases.mjs"),
  ]);
}, 30000);
