import { describe, it, expect, vi } from "vitest";
import { createAiderDriver } from "../aider.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd === "aider --version") return "aider 0.82.0\n";
    return "";
  }),
}));

describe("aider driver", () => {
  const driver = createAiderDriver();

  it("has name 'aider'", () => {
    expect(driver.name).toBe("aider");
    expect(driver.templateSuffix).toBe("generic");
  });

  it("builds command with --message and --yes", () => {
    const cmd = driver.buildCommand({
      prompt: "refactor the module",
      workdir: "/tmp/test",
      role: "crew",
      model: "gpt-4.1",
      autoApprove: true,
    });
    expect(cmd).toContain('aider --message');
    expect(cmd).toContain("--model gpt-4.1");
    expect(cmd).toContain("--yes");
    expect(cmd).toContain("--no-stream");
  });

  it("probes capabilities", async () => {
    const result = await driver.probe();
    expect(result.installed).toBe(true);
    expect(result.capabilities).toContain("auto_approve");
    expect(result.capabilities).toContain("model_routing");
    expect(result.capabilities).not.toContain("json_output");
    expect(result.capabilities).not.toContain("teams");
  });

  it("returns raw text output", () => {
    const raw = "Applied changes to file.py";
    const result = driver.parseOutput(raw);
    expect(result.status).toBe("success");
    expect(result.output).toBe("Applied changes to file.py");
  });
});
