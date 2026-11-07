// TypeScript CLI runner with synchronous Node loader hooks. No generated code or secret files.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
import { readFileSync } from "node:fs";
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !path.extname(specifier))
        return nextResolve(specifier + ".ts", context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
await import(pathToFileURL(path.resolve(process.argv[2])).href);
