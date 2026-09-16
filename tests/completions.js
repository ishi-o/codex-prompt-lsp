#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-completions-"));
const codexHome = path.join(workspace, ".codex-home");
const skillDir = path.join(codexHome, "skills", "commit");
const promptDir = path.join(codexHome, "prompts");
const fakeCodexBin = path.join(workspace, "bin");
const serverPath =
  process.env.CODEX_LSP_SERVER || path.join(repoRoot, "server/dist/server.js");

fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(promptDir, { recursive: true });
fs.mkdirSync(fakeCodexBin, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  "---\nname: commit\ndescription: Create a commit\n---\n",
);
fs.writeFileSync(
  path.join(promptDir, "fuzzy-command.md"),
  "---\ndescription: Fuzzy command fixture\n---\n",
);
fs.writeFileSync(
  path.join(fakeCodexBin, "codex"),
  '#!/bin/sh\nprintf \'{"installed":[{"id":"example-plugin@fixtures","display_name":"Example Plugin","description":"Fixture plugin"}]}\'\n',
  { mode: 0o755 },
);

for (const relativePath of [
  "direct-file.txt",
  "src/deep/nested-file.md",
  "src/completion.ts",
  "src/very/deeply/nested/deeply-nested-file.md",
  "modules/example/src/main/java/com/example/project/VeryDeepJavaFile.java",
  ".github/workflows/dot-file.yml",
  "node_modules/dependency.js",
  "dist/generated.js",
  "package-lock.json",
  "minified.min.js",
]) {
  const filename = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, "");
}

const server = spawn(process.execPath, [serverPath, "--stdio"], {
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
    PATH: `${fakeCodexBin}:${process.env.PATH || ""}`,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

let nextRequestId = 1;
let outputBuffer = "";
const pendingRequests = new Map();

function writeMessage(message) {
  const body = JSON.stringify(message);
  server.stdin.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function notify(method, params) {
  writeMessage({ jsonrpc: "2.0", method, params });
}

function request(method, params) {
  const id = nextRequestId++;
  writeMessage({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) =>
    pendingRequests.set(id, { resolve, reject }),
  );
}

server.stdout.on("data", (chunk) => {
  outputBuffer += chunk;

  while (true) {
    const headerEnd = outputBuffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;

    const header = outputBuffer.slice(0, headerEnd);
    const contentLength = Number(/^Content-Length: (\d+)$/m.exec(header)?.[1]);
    if (!contentLength || outputBuffer.length < headerEnd + 4 + contentLength)
      return;

    const bodyStart = headerEnd + 4;
    const message = JSON.parse(
      outputBuffer.slice(bodyStart, bodyStart + contentLength),
    );
    outputBuffer = outputBuffer.slice(bodyStart + contentLength);

    if (!message.id || !pendingRequests.has(message.id)) continue;
    const pending = pendingRequests.get(message.id);
    pendingRequests.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
});

async function completions(documentUri, text) {
  notify("textDocument/didChange", {
    textDocument: { uri: documentUri, version: Date.now() },
    contentChanges: [{ text }],
  });

  return request("textDocument/completion", {
    textDocument: { uri: documentUri },
    position: { line: 0, character: text.length },
    context:
      text.includes(".") && text.startsWith("@")
        ? { triggerKind: 3 }
        : { triggerKind: 1 },
  });
}

async function completionsUntil(documentUri, text, predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await completions(documentUri, text);
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Completion predicate timed out for ${text}`);
}

const timeout = setTimeout(() => {
  console.error("Completion integration test timed out");
  server.kill();
  process.exit(1);
}, 10000);
timeout.unref();

(async () => {
  const documentUri = "file:///codex-completions-prompt.md";
  const initialization = await request("initialize", {
    processId: process.pid,
    workspaceFolders: [{ uri: `file://${workspace}`, name: "workspace" }],
    capabilities: {},
  });

  assert.deepEqual(
    initialization.capabilities.completionProvider.triggerCharacters,
    ["/", "$", "@"],
  );

  notify("initialized", {});
  notify("textDocument/didOpen", {
    textDocument: {
      uri: documentUri,
      languageId: "markdown",
      version: 1,
      text: "",
    },
  });

  const slashResult = await completions(documentUri, "/fzcmd");
  assert.equal(slashResult.isIncomplete, true);
  assert.ok(slashResult.items.some((item) => item.label === "/fuzzy-command"));

  const skillResult = await completions(documentUri, "$cmt");
  assert.equal(skillResult.isIncomplete, true);
  assert.equal(skillResult.items[0].textEdit.newText, "$commit");
  assert.deepEqual(skillResult.items[0].textEdit.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 4 },
  });

  const reopenedSkillResult = await completions(documentUri, "$com");
  assert.equal(reopenedSkillResult.isIncomplete, true);
  assert.equal(reopenedSkillResult.items[0].textEdit.newText, "$commit");

  const unifiedSkillResult = await completions(documentUri, "@cmt");
  assert.ok(
    unifiedSkillResult.items.some(
      (item) =>
        item.label === "$commit" &&
        item.textEdit.newText === "$commit" &&
        item.filterText === "@cmt",
    ),
  );

  const pluginResult = await completionsUntil(documentUri, "@xmpl", (result) =>
    result.items.some(
      (item) =>
        item.label === "@Example Plugin" &&
        item.textEdit.newText === "@Example Plugin" &&
        item.filterText === "@xmpl",
    ),
  );
  assert.ok(pluginResult.items.length > 0);

  const nestedFileResult = await completions(documentUri, "@nested-file");
  assert.equal(nestedFileResult.isIncomplete, true);
  assert.ok(
    nestedFileResult.items.some(
      (item) =>
        item.label === "@src/../nested-file.md" &&
        item.textEdit.newText === "src/deep/nested-file.md" &&
        item.filterText === "@nested-file",
    ),
  );

  const dottedFileResult = await completions(documentUri, "@VeryDeepJavaFile.");
  assert.ok(
    dottedFileResult.items.some(
      (item) =>
        item.label === "@modules/../VeryDeepJavaFile.java" &&
        item.textEdit.newText ===
          "modules/example/src/main/java/com/example/project/VeryDeepJavaFile.java" &&
        item.filterText === "@VeryDeepJavaFile." &&
        item.sortText === "00000000",
    ),
  );

  const nonMentionDotResult = await completions(documentUri, "sentence.");
  assert.deepEqual(nonMentionDotResult, {
    isIncomplete: false,
    items: [],
  });

  const dotFileResult = await completions(documentUri, "@dot-file");
  assert.equal(dotFileResult.isIncomplete, true);
  assert.ok(
    dotFileResult.items.some(
      (item) =>
        item.label === "@.github/../dot-file.yml" &&
        item.textEdit.newText === ".github/workflows/dot-file.yml",
    ),
  );

  const deeplyNestedFileResult = await completions(
    documentUri,
    "@deeply-nested-file",
  );
  assert.equal(deeplyNestedFileResult.isIncomplete, true);
  assert.ok(
    deeplyNestedFileResult.items.some(
      (item) =>
        item.textEdit.newText ===
        "src/very/deeply/nested/deeply-nested-file.md",
    ),
  );

  const fuzzyFilenameResult = await completions(documentUri, "@nstdfil");
  assert.equal(fuzzyFilenameResult.isIncomplete, true);
  assert.ok(
    fuzzyFilenameResult.items.some(
      (item) => item.textEdit.newText === "src/deep/nested-file.md",
    ),
  );

  const fuzzyPathResult = await completions(documentUri, "@src/cmpl");
  assert.ok(
    fuzzyPathResult.items.some(
      (item) => item.textEdit.newText === "src/completion.ts",
    ),
  );

  for (const [ignoredPrefix, ignoredPath] of [
    ["@dependency.js", "node_modules/dependency.js"],
    ["@generated.js", "dist/generated.js"],
    ["@package-lock", "package-lock.json"],
    ["@minified.js", "minified.min.js"],
  ]) {
    const ignoredFilesResult = await completions(documentUri, ignoredPrefix);
    assert.equal(ignoredFilesResult.isIncomplete, true);
    assert.ok(
      !ignoredFilesResult.items.some(
        (item) => item.textEdit.newText === ignoredPath,
      ),
    );
  }

  server.kill();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  server.kill();
  process.exit(1);
});
