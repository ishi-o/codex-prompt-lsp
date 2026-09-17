import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type DocumentSelector,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

const section = "codexPromptLsp";
const activeContext = `${section}.active`;

let client: LanguageClient | undefined;
let documentSelector: DocumentSelector = [];
let completionTokens = new Set<string>();
let restartPromise = Promise.resolve();

const mentionBeforePattern = /(?:^|[^\w_])(\$[A-Za-z][A-Za-z0-9_-]*|@[A-Za-z0-9][A-Za-z0-9._/-]*)$/;
const mentionAfterPattern = /^(\$[A-Za-z][A-Za-z0-9_-]*|@[A-Za-z0-9][A-Za-z0-9._/-]*)/;

const slashDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor("symbolIcon.functionForeground"),
});
const skillDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor("symbolIcon.classForeground"),
});
const pluginDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor("symbolIcon.moduleForeground"),
});

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(section);
}

function codexHome(): string {
  const configured = configuration().get<string>("codexHome", "").trim();
  const value =
    configured || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function globPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/([*?{}[\]])/g, "\\$1");
}

function selectors(): DocumentSelector {
  const config = configuration();
  const result: DocumentSelector = [];
  const languages = config
    .get<string[]>("languageIds", ["markdown"])
    .filter(Boolean);
  const extensions = config
    .get<string[]>("fileExtensions", [".md"])
    .map((extension) => extension.trim().replace(/^\*+/, ""))
    .filter(Boolean)
    .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
  const patterns: string[] = [];

  if (config.get<boolean>("detectCodexHome", true)) {
    for (const extension of extensions) {
      patterns.push(`${globPath(codexHome())}/**/*${extension}`);
    }
  }
  if (config.get<boolean>("detectProjectCodexDirectories", true)) {
    for (const extension of extensions) {
      patterns.push(`**/.codex/**/*${extension}`);
    }
  }

  for (const pattern of patterns) {
    if (languages.length === 0) {
      result.push({ scheme: "file", pattern });
    } else {
      for (const language of languages) {
        result.push({ language, scheme: "file", pattern });
      }
    }
  }

  return result.concat(
    config.get<DocumentSelector>("documentSelectors", []),
  );
}

function isCodexDocument(document: vscode.TextDocument): boolean {
  return vscode.languages.match(
    documentSelector as vscode.DocumentSelector,
    document,
  ) > 0;
}

function captureCompletionTokens(
  result: vscode.CompletionItem[] | vscode.CompletionList | undefined | null,
): void {
  const items = result instanceof vscode.CompletionList ? result.items : result;
  for (const item of items ?? []) {
    const text = item.insertText;
    const value = typeof text === "string" ? text : text?.value;
    if (value?.startsWith("$") || value?.startsWith("@")) {
      completionTokens.add(value);
    }
  }
}

function tokenContinuation(token: string): RegExp {
  return token.startsWith("$")
    ? /[A-Za-z0-9_-]/
    : /[A-Za-z0-9._/-]/;
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  documentSelector = selectors();
  completionTokens.clear();
  if (
    !configuration().get<boolean>("enable", true) ||
    documentSelector.length === 0 ||
    !vscode.workspace.textDocuments.some(isCodexDocument)
  ) {
    updateEditors();
    return;
  }

  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    middleware: {
      async provideCompletionItem(document, position, context, token, next) {
        const result = await next(document, position, context, token);
        captureCompletionTokens(result);
        return result;
      },
    },
  };

  client = new LanguageClient(
    "codex-prompt",
    "codex-prompt",
    serverOptions,
    clientOptions,
  );
  await client.start();

  const experimental = client.initializeResult?.capabilities.experimental as
    | { codexCompletionTokens?: unknown }
    | undefined;
  if (Array.isArray(experimental?.codexCompletionTokens)) {
    for (const token of experimental.codexCompletionTokens) {
      if (typeof token === "string") completionTokens.add(token);
    }
  }
  updateEditors();
}

async function restartClient(context: vscode.ExtensionContext): Promise<void> {
  await client?.stop();
  client = undefined;
  await startClient(context);
}

function scheduleRestart(context: vscode.ExtensionContext): void {
  restartPromise = restartPromise.then(
    () => restartClient(context),
    () => restartClient(context),
  );
}

function tokenRangeBeforeCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const line = document.lineAt(position.line).text;
  const prefix = line.slice(0, position.character);
  const following = line[position.character] ?? "";

  for (const token of [...completionTokens].sort((a, b) => b.length - a.length)) {
    if (!prefix.endsWith(token)) continue;
    const start = position.character - token.length;
    const preceding = line[start - 1] ?? "";
    if (/\w/.test(preceding)) continue;
    const continuation = tokenContinuation(token);
    if (continuation.test(following)) continue;
    return new vscode.Range(
      position.line,
      start,
      position.line,
      position.character,
    );
  }
  return undefined;
}

function tokenRangeAfterCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const line = document.lineAt(position.line).text;
  const suffix = line.slice(position.character);
  const preceding = line[position.character - 1] ?? "";

  for (const token of [...completionTokens].sort((a, b) => b.length - a.length)) {
    if (!suffix.startsWith(token)) continue;
    if (/\w/.test(preceding)) continue;
    const end = position.character + token.length;
    const continuation = tokenContinuation(token);
    if (continuation.test(line[end] ?? "")) continue;
    return new vscode.Range(
      position.line,
      position.character,
      position.line,
      end,
    );
  }
  return undefined;
}

function mentionRangeBeforeCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const line = document.lineAt(position.line).text;
  const prefix = line.slice(0, position.character);
  const match = prefix.match(mentionBeforePattern);
  if (!match) return undefined;

  const token = match[1];
  const start = position.character - token.length;
  if (tokenContinuation(token).test(line[position.character] ?? "")) {
    return undefined;
  }
  return new vscode.Range(
    position.line,
    start,
    position.line,
    position.character,
  );
}

function mentionRangeAfterCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const line = document.lineAt(position.line).text;
  const suffix = line.slice(position.character);
  const preceding = line[position.character - 1] ?? "";
  const match = suffix.match(mentionAfterPattern);
  if (!match || /\w/.test(preceding)) return undefined;

  const token = match[1];
  const end = position.character + token.length;
  if (tokenContinuation(token).test(line[end] ?? "")) return undefined;
  return new vscode.Range(position.line, position.character, position.line, end);
}

async function atomicBackspace(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isCodexDocument(editor.document)) {
    await vscode.commands.executeCommand("deleteLeft");
    return;
  }

  const ranges = editor.selections.map((selection) =>
    selection.isEmpty
      ? tokenRangeBeforeCursor(editor.document, selection.active)
      : undefined,
  );
  if (ranges.some((range) => !range)) {
    await vscode.commands.executeCommand("deleteLeft");
    return;
  }
  await editor.edit((edit) => {
    for (const range of ranges) edit.delete(range!);
  });
}

type MoveDirection = "left" | "right";

function moveByCharacter(
  document: vscode.TextDocument,
  position: vscode.Position,
  direction: MoveDirection,
): vscode.Position {
  if (direction === "left") {
    if (position.character > 0) {
      return position.translate(0, -1);
    }
    if (position.line > 0) {
      return new vscode.Position(
        position.line - 1,
        document.lineAt(position.line - 1).text.length,
      );
    }
    return position;
  }

  const lineLength = document.lineAt(position.line).text.length;
  if (position.character < lineLength) {
    return position.translate(0, 1);
  }
  if (position.line + 1 < document.lineCount) {
    return new vscode.Position(position.line + 1, 0);
  }
  return position;
}

function moveSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  direction: MoveDirection,
): vscode.Selection {
  if (!selection.isEmpty) {
    const position = direction === "left" ? selection.start : selection.end;
    return new vscode.Selection(position, position);
  }

  const range =
    direction === "left"
      ? mentionRangeBeforeCursor(document, selection.active)
      : mentionRangeAfterCursor(document, selection.active);
  const position = range
    ? direction === "left"
      ? range.start
      : range.end
    : moveByCharacter(document, selection.active, direction);
  return new vscode.Selection(position, position);
}

async function atomicMove(direction: MoveDirection): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isCodexDocument(editor.document)) {
    await vscode.commands.executeCommand(
      direction === "left" ? "cursorLeft" : "cursorRight",
    );
    return;
  }
  if (!configuration().get<boolean>("atomicMove", true)) {
    await vscode.commands.executeCommand(
      direction === "left" ? "cursorLeft" : "cursorRight",
    );
    return;
  }

  editor.selections = editor.selections.map((selection) =>
    moveSelection(editor.document, selection, direction),
  );
}

function matchRanges(
  document: vscode.TextDocument,
  pattern: RegExp,
): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (!value || match.index === undefined) continue;
      const start = match.index + match[0].lastIndexOf(value);
      ranges.push(new vscode.Range(line, start, line, start + value.length));
    }
  }
  return ranges;
}

function updateDecorations(editor: vscode.TextEditor): void {
  const enabled =
    configuration().get<boolean>("enable", true) &&
    configuration().get<boolean>("highlightMentions", true) &&
    isCodexDocument(editor.document);
  editor.setDecorations(
    slashDecoration,
    enabled
      ? matchRanges(
          editor.document,
          /(?:^|\s)(\/[A-Za-z][A-Za-z0-9_-]*)/g,
        )
      : [],
  );
  editor.setDecorations(
    skillDecoration,
    enabled
      ? matchRanges(
          editor.document,
          /(?:^|\s)(\$[A-Za-z][A-Za-z0-9_-]*)/g,
        )
      : [],
  );
  editor.setDecorations(
    pluginDecoration,
    enabled
      ? matchRanges(
          editor.document,
          /(?:^|\s)(@[A-Za-z0-9][A-Za-z0-9._/-]*)/g,
        )
      : [],
  );
}

function updateEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    updateDecorations(editor);
  }
  const active = vscode.window.activeTextEditor;
  const enabled = configuration().get<boolean>("enable", true);
  void vscode.commands.executeCommand(
    "setContext",
    activeContext,
    Boolean(enabled && active && isCodexDocument(active.document)),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    slashDecoration,
    skillDecoration,
    pluginDecoration,
    vscode.commands.registerCommand(`${section}.atomicBackspace`, atomicBackspace),
    vscode.commands.registerCommand(`${section}.atomicMoveLeft`, () =>
      atomicMove("left"),
    ),
    vscode.commands.registerCommand(`${section}.atomicMoveRight`, () =>
      atomicMove("right"),
    ),
    vscode.window.onDidChangeActiveTextEditor(updateEditors),
    vscode.window.onDidChangeVisibleTextEditors(updateEditors),
    vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) updateDecorations(editor);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!client && isCodexDocument(document)) scheduleRestart(context);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(section)) scheduleRestart(context);
    }),
  );
  await startClient(context);
}

export async function deactivate(): Promise<void> {
  await restartPromise;
  await client?.stop();
  client = undefined;
}
