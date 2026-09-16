import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

type TriggerContext =
  | { type: "slash"; prefix: string }
  | { type: "skill"; prefix: string }
  | { type: "plugin"; prefix: string; start: number }
  | { type: "none" };

export function getTriggerContext(lineText: string): TriggerContext {
  // Match a slash command at start of line or after whitespace
  const slashMatch = lineText.match(/(?:^|\s)(\/[\w-]*)$/);
  if (slashMatch) return { type: "slash", prefix: slashMatch[1] };

  // Match $skill mention
  const skillMatch = lineText.match(/(?:^|\s)\$([\w-]*)$/);
  if (skillMatch) return { type: "skill", prefix: skillMatch[1] };

  // Match @ mention — the unified mention popup covers files, plugins, and skills
  const pluginMatch = lineText.match(/@(\S*)$/);
  if (pluginMatch) {
    return {
      type: "plugin",
      prefix: pluginMatch[1],
      start: pluginMatch.index ?? 0,
    };
  }

  return { type: "none" };
}

export function getSlashCompletions(
  prefix: string,
  commands: SlashCommand[],
): CompletionItem[] {
  return commands
    .filter((cmd) => cmd.name.startsWith(prefix))
    .map((cmd) => ({
      label: cmd.name,
      kind: CompletionItemKind.Function,
      detail: cmd.detail,
      // Documentation deferred to completionItem/resolve
      data: { type: "slash", name: cmd.name },
      insertText: cmd.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

export function getSkillCompletions(
  prefix: string,
  skills: Skill[],
): CompletionItem[] {
  return skills
    .filter((s) => s.name.startsWith(prefix))
    .map((s) => ({
      label: "$" + s.name,
      kind: CompletionItemKind.Class,
      detail: s.description || "Skill",
      data: { type: "skill", name: s.name },
      insertText: s.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

/**
 * Skill candidates offered from an `@` trigger (Codex's unified mention popup
 * includes skills alongside files and plugins). Skills are mentioned with the
 * `$` sigil, so the textEdit replaces the typed `@token` with `$name`.
 */
export function getSkillCompletionsAt(
  _: TextDocument,
  position: Position,
  tokenStart: number,
  prefix: string,
  skills: Skill[],
): CompletionItem[] {
  return skills
    .filter((s) => s.name.startsWith(prefix))
    .map((s) => ({
      label: "$" + s.name,
      kind: CompletionItemKind.Class,
      detail: s.description || "Skill",
      data: { type: "skill", name: s.name },
      textEdit: {
        range: {
          start: { line: position.line, character: tokenStart },
          end: position,
        },
        newText: "$" + s.name,
      },
    }));
}

export function getPluginCompletions(
  prefix: string,
  plugins: Plugin[],
): CompletionItem[] {
  return plugins
    .filter((p) => p.name.startsWith(prefix))
    .map((p) => ({
      label: "@" + p.name,
      kind: CompletionItemKind.Module,
      detail: p.id,
      data: { type: "plugin", name: p.name },
      insertText: p.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

export function getFileCompletions(
  _: TextDocument,
  position: Position,
  tokenStart: number,
  prefix: string,
  rootPath: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const searchDir = prefix.includes("/")
    ? path.join(rootPath, prefix.substring(0, prefix.lastIndexOf("/")))
    : rootPath;

  try {
    for (const entry of listEntries(searchDir, rootPath)) {
      if (!entry.relPath.startsWith(prefix)) continue;
      items.push({
        label: "@" + entry.relPath,
        kind: entry.isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
        detail: entry.isDir ? "directory" : "file",
        data: { type: "file", path: entry.relPath },
        // Selecting a file mention consumes the `@` and writes the whole
        // path — the sigil is prompt state in the Codex composer, not text.
        textEdit: {
          range: {
            start: { line: position.line, character: tokenStart },
            end: position,
          },
          newText: entry.relPath,
        },
      });
      if (items.length >= 50) break;
    }
  } catch {
    // Ignore filesystem errors
  }

  return items;
}

interface DirEntry {
  relPath: string;
  isDir: boolean;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "__pycache__",
  "target",
  "build",
  "venv",
]);

const MAX_WALK_ENTRIES = 10000;

function walkDir(
  rootPath: string,
  dir: string,
  depth: number,
  maxDepth: number,
  results: DirEntry[],
): void {
  if (depth > maxDepth || results.length >= MAX_WALK_ENTRIES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    results.push({
      relPath: path.relative(rootPath, fullPath),
      isDir: entry.isDirectory(),
    });
    if (entry.isDirectory()) {
      walkDir(rootPath, fullPath, depth + 1, maxDepth, results);
    }
    if (results.length >= MAX_WALK_ENTRIES) return;
  }
}

// Typing `@src/com…` fires one completion request per keystroke; the TTL
// keeps only the first request on disk.
const entryCache = new Map<
  string,
  { expiresAt: number; entries: DirEntry[] }
>();
const ENTRY_CACHE_TTL_MS = 2000;
const ENTRY_CACHE_MAX = 16;

function listEntries(searchDir: string, rootPath: string): DirEntry[] {
  const cached = entryCache.get(searchDir);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const entries: DirEntry[] = [];
  walkDir(rootPath, searchDir, 0, 3, entries);
  entryCache.set(searchDir, {
    expiresAt: Date.now() + ENTRY_CACHE_TTL_MS,
    entries,
  });

  // Map iteration order is insertion order — evict the oldest.
  if (entryCache.size > ENTRY_CACHE_MAX) {
    const oldest = entryCache.keys().next().value;
    if (oldest !== undefined) entryCache.delete(oldest);
  }
  return entries;
}

export async function getCompletions(
  doc: TextDocument,
  position: Position,
  rootPath: string,
  commands: SlashCommand[],
  skills: Skill[],
  plugins: Plugin[],
): Promise<CompletionItem[]> {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  const ctx = getTriggerContext(lineText);

  if (ctx.type === "slash") {
    return getSlashCompletions(ctx.prefix, commands);
  }
  if (ctx.type === "skill") {
    return getSkillCompletions(ctx.prefix, skills);
  }
  if (ctx.type === "plugin") {
    // @ in the Codex composer opens the unified mention popup: fuzzy file
    // search merged with plugin and skill candidates.
    const pluginItems = getPluginCompletions(ctx.prefix, plugins);
    const skillItems = getSkillCompletionsAt(
      doc,
      position,
      ctx.start,
      ctx.prefix,
      skills,
    );
    const fileItems = getFileCompletions(
      doc,
      position,
      ctx.start,
      ctx.prefix,
      rootPath,
    );
    return [...pluginItems, ...skillItems, ...fileItems];
  }

  return [];
}
