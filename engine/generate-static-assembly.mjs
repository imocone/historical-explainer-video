import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStaticAssemblyPackages, writeStaticAssembly } from "./static-assembly.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = await loadStaticAssemblyPackages(root);
const files = await writeStaticAssembly({ root, packages });
console.log(`generated ${files.length} static assembly files`);
