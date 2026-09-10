import { execFileSync } from "node:child_process";

/** Runs a scenario's `verify` command in `dir` (after the agent has finished) and
 * returns whether stdout matched `expect`. Scenarios with no `verify` pass this
 * trivially — their `done(files, finalText)` check is authoritative. */
export function verifyScenario(scenario, dir) {
  if (!scenario.verify) return true;
  try {
    const out = execFileSync(scenario.verify.cmd[0], scenario.verify.cmd.slice(1), {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return scenario.verify.expect.test(out);
  } catch {
    return false;
  }
}
