#!/usr/bin/env node
/**
 * Production build: compiles src/**\/*.ts to dist/ file by file (TypeScript's transpileModule), without type-checking.
 *
 * Why: the droplet caps Node at 512 MB, and a full `tsc` / `nest build` has to load Prisma's generated types for every model —
 * it needed more than 512 MB from Day 10 on and the deploy failed after `prebuild` had emptied dist. Compiling file by file needs
 * a few dozen MB. Type errors are caught before committing instead: run `npm run typecheck` (full tsc, no output) locally.
 *
 * Output matches tsc's JavaScript (same tsconfig.build.json options: CommonJS, ES2022, decorators + metadata, source maps), except that
 * decorator type metadata for imported names is written with a runtime guard (`typeof X !== "undefined"`), as TypeScript does for any
 * isolated-module build.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.build.json');
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  },
});
if (parsed.errors.length) {
  console.error(ts.formatDiagnostics(parsed.errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exit(1);
}

const srcRoot = path.join(root, 'src');
const outDir = parsed.options.outDir;
const compilerOptions = { ...parsed.options, declaration: false, incremental: false, composite: false, tsBuildInfoFile: undefined, noEmit: false };
const files = parsed.fileNames.filter((f) => !f.endsWith('.d.ts'));
let failed = false;

for (const file of files) {
  const abs = path.resolve(file);
  if (!abs.startsWith(srcRoot + path.sep)) {
    console.error(`Unexpected file outside src/: ${file}`);
    process.exit(1);
  }
  const rel = path.relative(srcRoot, abs).replace(/\.ts$/, '.js');
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { fileName: abs, compilerOptions, reportDiagnostics: true });
  if (out.diagnostics?.length) {
    failed = true;
    console.error(ts.formatDiagnostics(out.diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
    continue;
  }
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.outputText);
  if (out.sourceMapText) {
    const map = JSON.parse(out.sourceMapText);
    map.sources = [path.relative(path.dirname(target), abs).split(path.sep).join('/')];
    fs.writeFileSync(`${target}.map`, JSON.stringify(map));
  }
}

if (failed) process.exit(1);
console.log(`Compiled ${files.length} files to ${path.relative(root, outDir)}/`);
