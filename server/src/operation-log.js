import fs from "node:fs";
import path from "node:path";

export function createOperationLogger({ logDir = process.env.LOG_DIR || path.resolve("logs") } = {}) {
  fs.mkdirSync(logDir, { recursive: true });

  function write(type, detail = {}) {
    const now = new Date();
    const file = path.join(logDir, `operations-${now.toISOString().slice(0, 10)}.jsonl`);
    const row = {
      at: now.toISOString(),
      type,
      ...redact(detail)
    };
    fs.appendFile(file, `${JSON.stringify(row)}\n`, () => {});
  }

  return { write };
}

function redact(detail) {
  const output = { ...detail };
  for (const key of Object.keys(output)) {
    if (/password|token|secret/i.test(key)) {
      output[key] = "[redacted]";
    }
  }
  return output;
}
