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
const cachedPluginManifestDir = path.join(
  codexHome,
  "plugins",
  "cache",
  "openai-curated",
  "openai-templates",
  "0.1.1",
  ".codex-plugin",
);
fs.mkdirSync(cachedPluginManifestDir, { recursive: true });
fs.writeFileSync(
  path.join(cachedPluginManifestDir, "plugin.json"),
  JSON.stringify({
    name: "openai-templates",
    interface: {
      displayName: "Default templates",
      shortDescription:
        "Default templates for documents, spreadsheets, and presentations",
    },
  }),
);
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  "---\nname: commit\ndescription: Create a commit\n---\n",
);
fs.writeFileSync(
  path.join(promptDir, "fuzzy-command.md"),
  "---\ndescription: Fuzzy command fixture\n---\n",
);
const installedPlugins = {
  installed: [
    {
      id: "example-plugin@fixtures",
      name: "example-plugin",
      display_name: "Example Plugin",
      description: "Fixture plugin",
    },
    {
      id: "plugin-management@openai-curated",
      name: "plugin-management",
      release: {
        display_name: "Plugin-Management",
        description: "Plugin management",
      },
    },
    {
      id: "openai-templates@openai-curated",
      name: "openai-templates",
    },
  ],
};
fs.writeFileSync(
  path.join(fakeCodexBin, "codex"),
  `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(installedPlugins)}'\n`,
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

function insertedText(text) {
  return `${text} `;
}

function assertContiguousClasses(items) {
  const seenClasses = new Set();
  let previousClass;

  for (const item of items) {
    const currentClass = item.data?.type;
    if (!currentClass || currentClass === previousClass) continue;
    assert.equal(
      seenClasses.has(currentClass),
      false,
      `completion class ${currentClass} was split into multiple groups`,
    );
    seenClasses.add(currentClass);
    previousClass = currentClass;
  }
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
  assert.ok(
    initialization.capabilities.experimental.codexCompletionTokens.includes(
      "@Plugin-Management",
    ),
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
  assert.ok(
    slashResult.items.some(
      (item) =>
        item.label === "/fuzzy-command" &&
        item.textEdit.newText === insertedText("/fuzzy-command") &&
        item.kind === 14 &&
        item.sortText === "slash:00000000",
    ),
  );

  const skillResult = await completions(documentUri, "$cmt");
  assert.equal(skillResult.isIncomplete, true);
  assert.equal(skillResult.items[0].textEdit.newText, insertedText("$commit"));
  assert.deepEqual(skillResult.items[0].textEdit.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 4 },
  });

  const reopenedSkillResult = await completions(documentUri, "$com");
  assert.equal(reopenedSkillResult.isIncomplete, true);
  assert.equal(
    reopenedSkillResult.items[0].textEdit.newText,
    insertedText("$commit"),
  );

  const unifiedSkillResult = await completions(documentUri, "@cmt");
  assert.ok(
    unifiedSkillResult.items.some(
      (item) =>
        item.label === "$commit" &&
        item.textEdit.newText === insertedText("$commit") &&
        item.filterText === "@cmt",
    ),
  );

  const pluginResult = await completionsUntil(documentUri, "@xmpl", (result) =>
    result.items.some(
      (item) =>
        item.label === "@Example-Plugin" &&
        item.textEdit.newText === insertedText("@Example-Plugin") &&
        item.filterText === "@xmpl",
    ),
  );
  assert.ok(pluginResult.items.length > 0);

  const pluginManagementResult = await completions(
    documentUri,
    "@plugin-management",
  );
  assert.ok(
    pluginManagementResult.items.some(
      (item) =>
        item.label === "@Plugin-Management" &&
        item.textEdit.newText === insertedText("@Plugin-Management") &&
        item.filterText === "@plugin-management",
    ),
  );

  const openaiTemplatesResult = await completions(
    documentUri,
    "@openai-templates",
  );
  assert.ok(
    openaiTemplatesResult.items.some(
      (item) =>
        item.label === "@Openai-Templates" &&
        item.textEdit.newText === insertedText("@Openai-Templates") &&
        item.filterText === "@openai-templates",
    ),
  );

  const caseInsensitivePluginResult = await completions(
    documentUri,
    "@PLUGIN-MANAGEMENT",
  );
  assert.ok(
    caseInsensitivePluginResult.items.some(
      (item) => item.label === "@Plugin-Management",
    ),
  );

  const titlePluginResult = await completions(documentUri, "@default");
  assert.ok(
    titlePluginResult.items.some(
      (item) =>
        item.label === "@Openai-Templates" &&
        item.textEdit.newText === insertedText("@Openai-Templates"),
    ),
  );

  const emptyMentionResult = await completions(documentUri, "@");
  assert.ok(
    emptyMentionResult.items.every((item) => item.data?.type !== "file"),
  );

  const unifiedOrderResult = await completions(documentUri, "@m");
  assertContiguousClasses(unifiedOrderResult.items);

  const nestedFileResult = await completions(documentUri, "@nested-file");
  assert.equal(nestedFileResult.isIncomplete, true);
  assert.ok(
    nestedFileResult.items.some(
      (item) =>
        item.label === "@src/../nested-file.md" &&
        item.textEdit.newText === insertedText("src/deep/nested-file.md") &&
        item.filterText === "@nested-file",
    ),
  );

  const dottedFileResult = await completions(documentUri, "@VeryDeepJavaFile.");
  assert.ok(
    dottedFileResult.items.some(
      (item) =>
        item.label === "@modules/../VeryDeepJavaFile.java" &&
        item.textEdit.newText ===
          insertedText(
            "modules/example/src/main/java/com/example/project/VeryDeepJavaFile.java",
          ) &&
        item.filterText === "@VeryDeepJavaFile." &&
        item.sortText === "file:00000000",
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
        item.textEdit.newText ===
          insertedText(".github/workflows/dot-file.yml"),
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
        insertedText("src/very/deeply/nested/deeply-nested-file.md"),
    ),
  );

  const fuzzyFilenameResult = await completions(documentUri, "@nstdfil");
  assert.equal(fuzzyFilenameResult.isIncomplete, true);
  assert.ok(
    fuzzyFilenameResult.items.some(
      (item) =>
        item.textEdit.newText === insertedText("src/deep/nested-file.md"),
    ),
  );

  const fuzzyPathResult = await completions(documentUri, "@src/cmpl");
  assert.ok(
    fuzzyPathResult.items.some(
      (item) => item.textEdit.newText === insertedText("src/completion.ts"),
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
        (item) => item.textEdit.newText === insertedText(ignoredPath),
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
