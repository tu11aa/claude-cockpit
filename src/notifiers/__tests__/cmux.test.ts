import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCmuxNotifier } from "../cmux.js";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execSync: execMock,
}));

describe("CmuxNotifier", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("has name 'cmux'", () => {
    expect(createCmuxNotifier({}).name).toBe("cmux");
  });

  it("notify shells out to 'cockpit runtime send --command'", async () => {
    execMock.mockReturnValue("");
    await createCmuxNotifier({}).notify("hello world");
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("cockpit runtime send");
    expect(calls[0]).toContain("--command");
    expect(calls[0]).toContain("hello world");
  });

  it("notify escapes double-quotes in the message", async () => {
    execMock.mockReturnValue("");
    await createCmuxNotifier({}).notify('say "hi"');
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain('\\"hi\\"');
  });

  it("notify throws when cockpit runtime send fails", async () => {
    execMock.mockImplementation(() => { throw new Error("send failed"); });
    await expect(createCmuxNotifier({}).notify("x")).rejects.toThrow(/send failed/);
  });

  it("probe returns installed+reachable=true when status succeeds (exit 0)", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("cockpit runtime status --command")) return "running";
      return "";
    });
    const probe = await createCmuxNotifier({}).probe();
    expect(probe.installed).toBe(true);
    expect(probe.reachable).toBe(true);
  });

  it("probe returns reachable=false when status throws (non-zero exit)", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("cockpit runtime status --command")) {
        const err: Error & { status?: number } = new Error("stopped");
        err.status = 1;
        throw err;
      }
      return "";
    });
    const probe = await createCmuxNotifier({}).probe();
    expect(probe.installed).toBe(true);
    expect(probe.reachable).toBe(false);
  });

  it("probe returns installed=false when cockpit binary is missing", async () => {
    execMock.mockImplementation(() => {
      const err: Error & { code?: string } = new Error("cockpit: command not found");
      err.code = "ENOENT";
      throw err;
    });
    const probe = await createCmuxNotifier({}).probe();
    expect(probe.installed).toBe(false);
    expect(probe.reachable).toBe(false);
  });
});
