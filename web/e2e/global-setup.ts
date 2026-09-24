import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

export const FIXTURES = resolve(import.meta.dirname, ".fixtures");

export default function globalSetup() {
  rmSync(FIXTURES, { recursive: true, force: true });
  execFileSync("uv", ["run", "python", "-m", "tests.fixtures", FIXTURES], { cwd: resolve(import.meta.dirname, "../.."), stdio: "inherit" });
}
