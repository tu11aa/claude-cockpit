import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCmuxDriver } from "../cmux.js";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execSync: execMock,
}));

describe("cmux driver", () => {
  const driver = createCmuxDriver();

  beforeEach(() => {
    execMock.mockReset();
  });

  it("has name 'cmux'", () => {
    expect(driver.name).toBe("cmux");
  });

  it("probe returns installed=true with version when cmux responds", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("--version")) return "cmux 0.12.3\n";
      return "";
    });
    const result = await driver.probe();
    expect(result.installed).toBe(true);
    expect(result.version).toBe("cmux 0.12.3");
  });

  it("probe returns installed=false when cmux throws", async () => {
    execMock.mockImplementation(() => { throw new Error("not found"); });
    const result = await driver.probe();
    expect(result.installed).toBe(false);
    expect(result.version).toBe("");
  });

  it("list parses list-workspaces output into WorkspaceRefs", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("list-workspaces")) {
        return [
          "workspace:1  🏛️ command  (running)",
          "workspace:2  brove-captain  [selected]",
          "workspace:3  ⚡ reactor  (running)",
        ].join("\n");
      }
      return "";
    });
    const refs = await driver.list();
    expect(refs).toHaveLength(3);
    expect(refs[1]).toEqual({ id: "workspace:2", name: "brove-captain", status: "running" });
  });

  it("status returns null when name not in list", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("list-workspaces")) return "workspace:1  other-ws  (running)";
      return "";
    });
    const ref = await driver.status("brove-captain");
    expect(ref).toBeNull();
  });

  it("status returns WorkspaceRef when name matches", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("list-workspaces")) return "workspace:5  brove-captain  (running)";
      return "";
    });
    const ref = await driver.status("brove-captain");
    expect(ref).toEqual({ id: "workspace:5", name: "brove-captain", status: "running" });
  });

  it("send calls cmux send THEN cmux send-key Enter", async () => {
    execMock.mockReturnValue("");
    await driver.send("workspace:2", "hello world");
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("send") && c.includes("hello world") && !c.includes("send-key"))).toBe(true);
    expect(calls.some((c) => c.includes("send-key") && c.includes("Enter"))).toBe(true);
  });

  it("send escapes double-quotes in message", async () => {
    execMock.mockReturnValue("");
    await driver.send("workspace:2", 'say "hi"');
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('\\"hi\\"'))).toBe(true);
  });

  it("sendKey sends literal key without Enter", async () => {
    execMock.mockReturnValue("");
    await driver.sendKey("workspace:2", "Escape");
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("send-key");
    expect(calls[0]).toContain("Escape");
  });

  it("stop calls close-workspace", async () => {
    execMock.mockReturnValue("");
    await driver.stop("workspace:2");
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("close-workspace");
    expect(calls[0]).toContain("workspace:2");
  });

  it("readScreen calls read-screen and returns output", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("read-screen")) return "screen contents\n";
      return "";
    });
    const out = await driver.readScreen("workspace:2");
    expect(out).toBe("screen contents");
  });

  it("spawn creates workspace, renames it, optionally pins, returns WorkspaceRef", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("new-workspace")) return "Created workspace:7\n";
      return "";
    });
    const ref = await driver.spawn({ name: "test-ws", workdir: "/tmp", command: "echo hi", pinToTop: true });
    expect(ref.id).toBe("workspace:7");
    expect(ref.name).toBe("test-ws");
    const calls = execMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("new-workspace"))).toBe(true);
    expect(calls.some((c) => c.includes("rename-workspace") && c.includes("test-ws"))).toBe(true);
    expect(calls.some((c) => c.includes("workspace-action") && c.includes("--action pin"))).toBe(true);
  });
});
