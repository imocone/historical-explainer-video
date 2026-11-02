import Ajv2020 from "ajv/dist/2020.js";
import { readResourceData } from "./files.mjs";
const formatAjvErrors = (errors = []) =>
  errors.map((error) =>
    `${error.instancePath || "/"} ${error.message}${error.keyword === "additionalProperties" ? `: ${error.params.additionalProperty}` : ""}`
  ).join("; ");

// Cache compiled code only. Callers still read and validate current files.
const compiledSchemas = new Map();

const compileSchema = (schema, label) => {
  const content = JSON.stringify(schema);
  const cached = compiledSchemas.get(label);
  if (cached?.content === content) return cached.validate;
  try {
    const validate = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true }).compile(
      schema
    );
    compiledSchemas.set(label, { content, validate });
    return validate;
  } catch (error) {
    throw new Error(`${label} 不是可编译的 JSON Schema: ${error.message}`);
  }
};

const validateSchema = async (schemaPath, value, label, resourceCache) => {
  const validate = compileSchema(await readResourceData(schemaPath, resourceCache), schemaPath);
  if (!validate(value)) throw new Error(`${label} 合同失败: ${formatAjvErrors(validate.errors)}`);
};

export { compileSchema, validateSchema };
