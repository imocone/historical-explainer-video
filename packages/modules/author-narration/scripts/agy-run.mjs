import { spawn } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { atomicWrite } from "../../../program-utils.mjs";

export async function runAgy({ cwd, prompt, receiptPath, conversationId, spawnImpl = spawn,
  onStart, progressMs = 60_000, report = message => process.stderr.write(`${message}\n`) }) {
  const stderrPath = receiptPath.replace(/\.json$/u, ".stderr.log");
  const exitPath = receiptPath.replace(/\.json$/u, ".exit.txt");
  const partialPath = receiptPath.replace(/\.json$/u, ".partial.txt");
  const label = `AGY ${path.basename(receiptPath)}`;
  const stdout = await open(receiptPath, "wx");
  let stderr, partial, timer;
  try {
    stderr = await open(stderrPath, "wx");
    await (await open(exitPath, "wx")).close();
    const args = ["-p", prompt, "--model", "gemini-3.8-flash-high", "--effort", "high",
      "--dangerously-skip-permissions", "--output-format", "stream-json", "--print-timeout", "60m"];
    if (conversationId) args.push("--conversation", conversationId);
    const child = spawnImpl("agy", args, { cwd, stdio: ["ignore", "pipe", stderr.fd] });
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    completion.catch(() => {});

    const began = Date.now();
    let lastEvent = began, activity = "等待会话", currentId = conversationId;
    let lastResponseStep, receipt, streamIssue;
    const bindConversation = id => {
      if (!id) return true;
      if (currentId && currentId !== id) {
        streamIssue = "AGY输出中的会话身份不一致";
        return false;
      }
      currentId = id;
      return true;
    };
    const receive = async () => {
      for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); }
        catch { streamIssue = "AGY实时输出包含无法读取的记录"; continue; }
        lastEvent = Date.now();
        if (event?.event === "init" && bindConversation(event.conversation_id)) {
          activity = "已建立会话";
        } else if (event?.event === "step_update" && event.step_update) {
          const step = event.step_update;
          if (!bindConversation(step.conversation_id)) continue;
          if (step.step_type === "tool") activity = step.state === "DONE" ? "已完成一次工具操作" : "正在使用工具";
          if (step.step_type !== "agent_response") continue;
          if (typeof step.text_delta === "string" && step.text_delta) {
            activity = "正在返回正文";
            partial ??= await open(partialPath, "wx");
            if (lastResponseStep !== undefined && lastResponseStep !== step.step_index) await partial.appendFile("\n\n", "utf8");
            await partial.appendFile(step.text_delta, "utf8");
            lastResponseStep = step.step_index;
          }
          if (step.state === "DONE" && partial && lastResponseStep === step.step_index) {
            activity = "已收到回复文字，等待最终回包";
            report(`${label} ${activity}，可先审阅 ${partialPath}`);
          }
        } else if (event?.event === "result") {
          if (receipt || !event.result || typeof event.result !== "object" || Array.isArray(event.result)) {
            streamIssue = "AGY未提供唯一可读的最终回包";
            continue;
          }
          receipt = event.result;
          bindConversation(receipt.conversation_id);
          await stdout.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
          activity = "原回包已保存，等待进程退出";
          report(`${label} ${activity}`);
        }
      }
    };
    const received = receive();
    received.catch(() => {});
    timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - began) / 1000);
      const quiet = Math.round((Date.now() - lastEvent) / 1000);
      report(`${label} 已运行 ${elapsed} 秒，${activity}，距上次输出 ${quiet} 秒${currentId ? `，会话 ${currentId}` : ""}`);
    }, progressMs);
    if (child.pid) report(`${label} 已启动，PID ${child.pid}`);
    const [closed, read, registered] = await Promise.allSettled([completion, received, onStart?.(child.pid)]);
    if (closed.status === "rejected") throw closed.reason;
    const { code, signal } = closed.value;
    if (read.status === "rejected") streamIssue ??= "AGY实时输出读取中断";
    const exitRecord = [code ?? signal ?? "unknown", ...(streamIssue ? [streamIssue] : [])];
    await atomicWrite(exitPath, `${exitRecord.join("\n")}\n`);
    if (read.status === "rejected") throw read.reason;
    if (registered.status === "rejected") throw registered.reason;

    const hasResponse = typeof receipt?.response === "string" && Boolean(receipt.response.trim());
    const reviewPath = hasResponse ? receiptPath : partial ? partialPath : null;
    if (partial && hasResponse && ((code === 0 && receipt.status === "SUCCESS")
      || (await readFile(partialPath, "utf8")).trimEnd() === receipt.response.trimEnd())) {
      await partial.close();
      partial = undefined;
      await rm(partialPath);
    }
    const diagnostic = await readFile(stderrPath, "utf8");
    const inspect = code !== 0 || signal || diagnostic.trim() || streamIssue || !hasResponse;
    return { receiptPath, stderrPath, exitPath, exitCode: code, signal, conversationId: currentId ?? null,
      reviewPath, action: inspect ? "inspect-call-result" : "receive-call-result",
      ...(partial ? { partialPath } : {}),
      ...(streamIssue ? { streamIssue } : {}) };
  } finally {
    clearInterval(timer);
    await Promise.all([stdout.close(), stderr?.close(), partial?.close()]);
  }
}
