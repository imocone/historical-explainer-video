import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertProjectPath, atomicWrite, readData, sha256 } from "./program-utils.mjs";

const variants = ["youtube", "vertical"];
const exactVariants = value => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...variants].sort().join(",");
const validText = value => Array.isArray(value) && value.length > 0
  && value.every(text => typeof text === "string" && text.trim());

// Keep the selected original inside the existing cover recovery directory.
export const prepareProvidedCovers = async ({ root, work, manifestPath }) => {
  const manifest = await readData(path.resolve(manifestPath));
  if (!exactVariants(manifest)) throw new Error("指定成图必须完整提供youtube和vertical两幅");
  const selected = {};
  for (const variant of variants) {
    const item = manifest[variant];
    if (!item || typeof item.source !== "string" || !path.isAbsolute(item.source) || !validText(item.visibleText)) {
      throw new Error(`${variant}指定成图须提供绝对source路径和完整visibleText`);
    }
    const info = await lstat(item.source);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 20 * 1024 * 1024) {
      throw new Error(`${variant}指定成图须为非空、非软链且不超过20MiB的本地文件`);
    }
    const bytes = await readFile(item.source);
    const digest = sha256(bytes);
    const destination = path.join(work, "provided", variant, digest, "source.png");
    await assertProjectPath({ root, file: destination, label: "用户指定封面原件" });
    await atomicWrite(destination, bytes);
    selected[variant] = {
      source: path.relative(root, destination).split(path.sep).join("/"),
      sha256: digest,
      visibleText: [...item.visibleText]
    };
  }
  return { mode: "user-provided-images", variants: selected };
};

export const assertProvidedCovers = async ({ root, adoption }) => {
  if (adoption?.mode !== "user-provided-images" || !exactVariants(adoption.variants)) {
    throw new Error("指定成图采用记录须完整绑定横竖两幅");
  }
  for (const variant of variants) {
    const item = adoption.variants[variant];
    if (typeof item?.source !== "string" || !item.source || path.isAbsolute(item.source)
      || item.source.split("/").some(part => !part || part === "." || part === "..")
      || !/^[a-f0-9]{64}$/u.test(item.sha256 ?? "") || !validText(item.visibleText)) {
      throw new Error(`${variant}指定成图采用记录无效`);
    }
    const source = path.resolve(root, item.source);
    await assertProjectPath({ root, file: source, label: "用户指定封面原件" });
    if (sha256(await readFile(source)) !== item.sha256) throw new Error(`${variant}指定封面原件摘要不一致`);
  }
  return adoption;
};
