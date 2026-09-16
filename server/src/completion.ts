import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { Fzf, byLengthAsc, byStartAsc } from "fzf";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

type TriggerContext =
  | { type: "slash"; prefix: string; start: number }
  | { type: "skill"; prefix: string; start: number }
  | { type: "plugin"; prefix: string; start: number }
  | { type: "none" };

export function getTriggerContext(lineText: string): TriggerContext {
  // Match a slash command at start of line or after whitespace
  const slashMatch = lineText.match(/(?:^|\s)(\/[\w-]*)$/);
  if (slashMatch) {
    return {
      type: "slash",
      prefix: slashMatch[1],
      start: lineText.length - slashMatch[1].length,
    };
  }

  // Match $skill mention
  const skillMatch = lineText.match(/(?:^|\s)\$([\w-]*)$/);
  if (skillMatch) {
    return {
      type: "skill",
      prefix: skillMatch[1],
      start: lineText.length - skillMatch[1].length - 1,
    };
  }

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

function replaceToken(position: Position, tokenStart: number, newText: string) {
  return {
    range: {
      start: { line: position.line, character: tokenStart },
      end: position,
    },
    newText,
  };
}

const MAX_COMPLETION_ITEMS = 100;

function fuzzyFind<T>(
  items: T[],
  query: string,
  selector: (item: T) => string,
): T[] {
  return new Fzf<unknown[]>(items, {
    selector: selector as (item: unknown) => string,
    limit: MAX_COMPLETION_ITEMS,
    forward: false,
  })
    .find(query)
    .map((result) => result.item as T);
}

function serverRankedMetadata(filterText: string, index: number) {
  const metadata: { filterText?: string; sortText: string } = {
    sortText: index.toString().padStart(8, "0"),
  };
  if (filterText) metadata.filterText = filterText;
  return metadata;
}

export function getSlashCompletions(
  prefix: string,
  commands: SlashCommand[],
  position: Position,
  tokenStart: number,
): CompletionItem[] {
  return fuzzyFind(commands, prefix, (cmd) => cmd.name).map((cmd, index) => ({
    label: cmd.name,
    kind: CompletionItemKind.Function,
    detail: cmd.detail,
    // Documentation deferred to completionItem/resolve
    data: { type: "slash", name: cmd.name },
    textEdit: replaceToken(position, tokenStart, cmd.name),
    ...serverRankedMetadata(prefix, index),
  }));
}

export function getSkillCompletions(
  prefix: string,
  skills: Skill[],
  position: Position,
  tokenStart: number,
): CompletionItem[] {
  return fuzzyFind(skills, prefix, (skill) => skill.name).map(
    (skill, index) => ({
      label: "$" + skill.name,
      kind: CompletionItemKind.Class,
      detail: skill.description || "Skill",
      data: { type: "skill", name: skill.name },
      textEdit: replaceToken(position, tokenStart, "$" + skill.name),
      ...serverRankedMetadata("$" + prefix, index),
    }),
  );
}

/**
 * Skill candidates offered from an `@` trigger (Codex's unified mention popup
 * includes skills alongside files and plugins). Skills are mentioned with the
 * `$` sigil, so the textEdit replaces the typed `@token` with `$name`.
 */
export function getSkillCompletionsAt(
  position: Position,
  tokenStart: number,
  prefix: string,
  skills: Skill[],
): CompletionItem[] {
  return fuzzyFind(skills, prefix, (skill) => skill.name).map(
    (skill, index) => ({
      label: "$" + skill.name,
      kind: CompletionItemKind.Class,
      detail: skill.description || "Skill",
      data: { type: "skill", name: skill.name },
      textEdit: replaceToken(position, tokenStart, "$" + skill.name),
      ...serverRankedMetadata("@" + prefix, index),
    }),
  );
}

export function getPluginCompletions(
  prefix: string,
  plugins: Plugin[],
  position: Position,
  tokenStart: number,
): CompletionItem[] {
  return fuzzyFind(plugins, prefix, (plugin) => plugin.name).map(
    (plugin, index) => ({
      label: "@" + plugin.name,
      kind: CompletionItemKind.Module,
      detail: plugin.id,
      data: { type: "plugin", name: plugin.name },
      textEdit: replaceToken(position, tokenStart, "@" + plugin.name),
      ...serverRankedMetadata("@" + prefix, index),
    }),
  );
}

export function getFileCompletions(
  position: Position,
  tokenStart: number,
  prefix: string,
  rootPath: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];

  try {
    for (const [index, entry] of listEntries(rootPath)
      .find(prefix)
      .map((result) => result.item)
      .entries()) {
      items.push({
        label: "@" + abbreviatedPath(entry.relPath),
        kind: entry.isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
        detail: entry.relPath,
        data: { type: "file", path: entry.relPath },
        // Selecting a file mention consumes the `@` and writes the whole
        // path — the sigil is prompt state in the Codex composer, not text.
        textEdit: replaceToken(position, tokenStart, entry.relPath),
        ...serverRankedMetadata("@" + prefix, index),
      });
      if (items.length >= MAX_COMPLETION_ITEMS) break;
    }
  } catch {
    // Ignore filesystem errors
  }

  return items;
}

function abbreviatedPath(relPath: string): string {
  const segments = relPath.split("/");
  if (segments.length <= 2) return relPath;
  return `${segments[0]}/../${segments[segments.length - 1]}`;
}

interface DirEntry {
  relPath: string;
  isDir: boolean;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".bloop",
  ".gradle",
  ".idea",
  ".metals",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  ".vscode",
  ".yarn",
  "node_modules",
  "__pycache__",
  "bower_components",
  "coverage",
  "DerivedData",
  "dist",
  "target",
  "build",
  "bin",
  "out",
  "output",
  "Pods",
  "vendor",
  "venv",
]);

const IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "flake.lock",
  "tags",
]);

const IGNORED_FILE_SUFFIXES = [
  ".log",
  ".tmp",
  ".map",
  ".min.js",
  ".min.css",
  ".class",
  ".jar",
  ".war",
  ".ear",
  ".o",
  ".a",
  ".so",
  ".dylib",
  ".exe",
  ".tsbuildinfo",
  ".pyc",
];

const MAX_WALK_ENTRIES = 100000;

function walkDir(rootPath: string, dir: string, results: DirEntry[]): void {
  if (results.length >= MAX_WALK_ENTRIES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    if (
      entry.isFile() &&
      (IGNORED_FILES.has(entry.name) ||
        IGNORED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)))
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    results.push({
      relPath: path.relative(rootPath, fullPath).split(path.sep).join("/"),
      isDir: entry.isDirectory(),
    });
    if (entry.isDirectory()) {
      walkDir(rootPath, fullPath, results);
    }
    if (results.length >= MAX_WALK_ENTRIES) return;
  }
}

// Typing `@src/com…` fires one completion request per keystroke; the TTL
// keeps only the first request on disk.
const entryCache = new Map<
  string,
  { expiresAt: number; entries: Fzf<DirEntry[]> }
>();
const ENTRY_CACHE_TTL_MS = 2000;
const ENTRY_CACHE_MAX = 16;

function listEntries(rootPath: string): Fzf<DirEntry[]> {
  const cached = entryCache.get(rootPath);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const entries: DirEntry[] = [];
  walkDir(rootPath, rootPath, entries);
  entries.sort((left, right) => left.relPath.localeCompare(right.relPath));
  const finder = new Fzf(entries, {
    selector: (entry) => entry.relPath,
    limit: MAX_COMPLETION_ITEMS,
    forward: false,
    tiebreakers: [byLengthAsc, byStartAsc],
  });
  entryCache.set(rootPath, {
    expiresAt: Date.now() + ENTRY_CACHE_TTL_MS,
    entries: finder,
  });

  // Map iteration order is insertion order — evict the oldest.
  if (entryCache.size > ENTRY_CACHE_MAX) {
    const oldest = entryCache.keys().next().value;
    if (oldest !== undefined) entryCache.delete(oldest);
  }
  return finder;
}

export async function getCompletions(
  doc: TextDocument,
  position: Position,
  rootPath: string,
  commands: SlashCommand[],
  skills: Skill[],
  plugins: Plugin[],
): Promise<CompletionList> {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  const ctx = getTriggerContext(lineText);

  if (ctx.type === "slash") {
    return {
      isIncomplete: true,
      items: getSlashCompletions(ctx.prefix, commands, position, ctx.start),
    };
  }
  if (ctx.type === "skill") {
    return {
      isIncomplete: true,
      items: getSkillCompletions(ctx.prefix, skills, position, ctx.start),
    };
  }
  if (ctx.type === "plugin") {
    // @ in the Codex composer opens the unified mention popup: fuzzy file
    // search merged with plugin and skill candidates.
    const pluginItems = getPluginCompletions(
      ctx.prefix,
      plugins,
      position,
      ctx.start,
    );
    const skillItems = getSkillCompletionsAt(
      position,
      ctx.start,
      ctx.prefix,
      skills,
    );
    const fileItems = getFileCompletions(
      position,
      ctx.start,
      ctx.prefix,
      rootPath,
    );
    return {
      isIncomplete: true,
      items: [...pluginItems, ...skillItems, ...fileItems],
    };
  }

  return { isIncomplete: false, items: [] };
}
