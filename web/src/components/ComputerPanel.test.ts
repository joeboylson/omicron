import { describe, expect, it } from "vitest";
import { setupFix, setupLines } from "./ComputerPanel";

describe("setup checks", () => {
  it("says what's wrong without a command, and offers the fix the page can do", () => {
    const f = setupFix("Start at login", "the daemon won't come back after a restart. Run `omicron daemon start-at-login`.");
    expect(f.fix).toBe("start-at-login");
    expect(f.said).not.toMatch(/omicron|daemon|`/);
    expect(setupFix("You", "a@b hasn't been used here yet. If you already use Omicron under another login, run `omicron people link <your person id> a@b`.").said).not.toMatch(/</);
  });
  it("shows the same fix once", () => {
    const lines = setupLines(["ok    Settings: x", "fix   Daemon: not running. Run `omicron daemon start-at-login`.", "fix   Start at login: the daemon won't come back after a restart. Run `omicron daemon start-at-login`.", "omicron: 2 things"]);
    expect(lines).toHaveLength(2);
  });
});
