import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertProjectPath, resolveContainedPath } from "../packages/program-utils.mjs";

test("公共路径边界拒绝目录逃逸和符号链接改道", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "path-safety-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "path-safety-outside-"));
  try {
    assert.throws(
      () => resolveContainedPath({ directory: root, relativePath: "../outside.txt" }),
      /越界/u
    );

    await mkdir(path.join(root, "safe"), { recursive: true });
    await symlink(outside, path.join(root, "safe", "redirect"), "dir");
    await assert.rejects(
      assertProjectPath({
        root,
        file: path.join(root, "safe", "redirect", "result.json")
      }),
      /不得包含符号链接/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
