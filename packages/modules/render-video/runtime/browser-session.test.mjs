import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { withBrowserSession } from "./browser-session.mjs";

const missing = async file => assert.rejects(access(file), { code: "ENOENT" });

test('a browser that never finishes close is killed and its scratch removed', { timeout: 10000 }, async () => {
  let pid, scratch;
  await withBrowserSession(async session => {
    const browser = await session.browser();
    pid = browser.process().pid; scratch = session.directory;
    browser.close = () => new Promise(() => {});
  });
  await missing(scratch);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test("scratch is removed on success and failure; delivered files survive", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "render-session-test-"));
  try {
    const output = path.join(parent, "preview.png");
    await writeFile(output, "delivered");
    for (const fail of [false, true]) {
      let scratch;
      const operation = withBrowserSession(async session => {
        scratch = session.directory;
        await writeFile(path.join(scratch, "partial.bundle"), "cache");
        if (fail) throw new Error("render failed");
        return "done";
      }, { scratchParent: parent });
      if (fail) await assert.rejects(operation, /render failed/);
      else assert.equal(await operation, "done");
      await missing(scratch);
      await access(output);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("SIGINT/SIGTERM/SIGKILL clean up a real browser and scratch", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "render-session-test-"));
  const module = new URL("./browser-session.mjs", import.meta.url).href;
  try {
    for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"]) {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { withBrowserSession } from ${JSON.stringify(module)};
        await withBrowserSession(async session => {
          await session.browser();
          process.stdout.write(session.directory + "\\n");
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        }, { scratchParent: ${JSON.stringify(parent)} });
      `], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."), stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", data => { stderr += data; });
      const exited = once(child, "exit");
      const scratch = await new Promise((resolve, reject) => {
        let text = "";
        child.stdout.on("data", data => { text += data; if (text.includes("\n")) resolve(text.trim()); });
        child.on("exit", () => reject(new Error(stderr || "browser startup failed")));
      });
      const { browserPid } = JSON.parse(await readFile(path.join(scratch, ".owner.json"), "utf8"));
      const profile = path.join(scratch,"profile");
      child.kill(signal);
      const [code, endedBy] = await exited;
      if (signal === "SIGKILL") {
        assert.equal(endedBy, signal);
        for (let attempt = 0; attempt < 100; attempt++) {
          try { await access(scratch); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
          await setTimeout(20);
        }
      } else assert.equal(code, signal === "SIGINT" ? 130 : 143);
      await missing(scratch);
      await missing(profile);
      for (let attempt = 0; attempt < 50; attempt++) {
        try { process.kill(browserPid, 0); }
        catch (error) { if (error.code === "ESRCH") break; throw error; }
        if (attempt === 49) throw new Error("orphan browser remains");
        await setTimeout(20);
      }
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});
