import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Position,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { Fzf, byLengthAsc, byStartAsc } from "fzf";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

export enum CompletionType {
  Slash = "slash",
  Skill = "skill",
  Plugin = "plugin",
  File = "file",
}

enum TriggerType {
  Slash = "slash",
  Skill = "skill",
  Mention = "mention",
  None = "none",
}

enum CompletionSortGroup {
  // The class prefix keeps each class contiguous without assigning a special
  // priority to plugins. The client still decides the order between classes.
  Slash = "slash",
  Skill = "skill",
  Plugin = "plugin",
  File = "file",
}

type TriggerContext =
  | { type: TriggerType.Slash; prefix: string; start: number }
  | { type: TriggerType.Skill; prefix: string; start: number }
  | { type: TriggerType.Mention; prefix: string; start: number }
  | { type: TriggerType.None };

export function getTriggerContext(lineText: string): TriggerContext {
  // Match a slash command at start of line or after whitespace
  const slashMatch = lineText.match(/(?:^|\s)(\/[\w-]*)$/);
  if (slashMatch) {
    return {
      type: TriggerType.Slash,
      prefix: slashMatch[1],
      start: lineText.length - slashMatch[1].length,
    };
  }

  // Match $skill mention
  const skillMatch = lineText.match(/(?:^|\s)\$([\w-]*)$/);
  if (skillMatch) {
    return {
      type: TriggerType.Skill,
      prefix: skillMatch[1],
      start: lineText.length - skillMatch[1].length - 1,
    };
  }

  // Match @ mention — the unified mention popup covers files, plugins, and skills
  const pluginMatch = lineText.match(/@(\S*)$/);
  if (pluginMatch) {
    return {
      type: TriggerType.Mention,
      prefix: pluginMatch[1],
      start: pluginMatch.index ?? 0,
    };
  }

  return { type: TriggerType.None };
}

const AT_PREFIX = "@";
const SKILL_PREFIX = "$";
const COMPLETION_TRAILING_SPACE = " ";
const MAX_COMPLETION_ITEMS = 100;
const SORT_TEXT_WIDTH = 8;

function replaceToken(
  position: Position,
  tokenStart: number,
  newText: string,
): TextEdit {
  return {
    range: {
      start: { line: position.line, character: tokenStart },
      end: position,
    },
    newText: newText + COMPLETION_TRAILING_SPACE,
  };
}

function fuzzyFind<T extends object>(
  items: T[],
  query: string,
  selector: (item: T) => string,
): T[] {
  // fzf's conditional option type cannot preserve a generic object element
  // type here, so keep the cast inside this small adapter.
  const finder = new Fzf<unknown[]>(items, {
    selector: (item) => selector(item as T),
    limit: MAX_COMPLETION_ITEMS,
    casing: "case-insensitive",
    forward: false,
  });
  return finder.find(query).map((result) => result.item as T);
}

type CompletionMetadata = Pick<CompletionItem, "filterText" | "sortText">;

function completionMetadata(
  filterText: string,
  index: number,
  group: CompletionSortGroup,
): CompletionMetadata {
  const metadata: CompletionMetadata = {
    sortText: `${group}:${index.toString().padStart(SORT_TEXT_WIDTH, "0")}`,
  };
  if (filterText) metadata.filterText = filterText;
  return metadata;
}

function pluginSearchText(plugin: Plugin): string {
  return [plugin.name, plugin.title, ...plugin.aliases, plugin.description]
    .filter(Boolean)
    .join(" ");
}

export function getSlashCompletions(
  prefix: string,
  commands: SlashCommand[],
  position: Position,
  tokenStart: number,
): CompletionItem[] {
  return fuzzyFind(commands, prefix, (cmd) => cmd.name).map((cmd, index) => ({
    label: cmd.name,
    // Slash commands are commands, not callable functions. Using Function
    // makes some clients append `()` to the inserted command.
    kind: CompletionItemKind.Keyword,
    detail: cmd.detail,
    // Documentation deferred to completionItem/resolve
    data: { type: CompletionType.Slash, name: cmd.name },
    textEdit: replaceToken(position, tokenStart, cmd.name),
    ...completionMetadata(prefix, index, CompletionSortGroup.Slash),
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
      label: SKILL_PREFIX + skill.name,
      kind: CompletionItemKind.Class,
      detail: skill.description || "Skill",
      data: { type: CompletionType.Skill, name: skill.name },
      textEdit: replaceToken(position, tokenStart, SKILL_PREFIX + skill.name),
      ...completionMetadata(
        SKILL_PREFIX + prefix,
        index,
        CompletionSortGroup.Skill,
      ),
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
      label: SKILL_PREFIX + skill.name,
      kind: CompletionItemKind.Class,
      detail: skill.description || "Skill",
      data: { type: CompletionType.Skill, name: skill.name },
      textEdit: replaceToken(position, tokenStart, SKILL_PREFIX + skill.name),
      ...completionMetadata(
        AT_PREFIX + prefix,
        index,
        CompletionSortGroup.Skill,
      ),
    }),
  );
}

export function getPluginCompletions(
  prefix: string,
  plugins: Plugin[],
  position: Position,
  tokenStart: number,
): CompletionItem[] {
  return fuzzyFind(plugins, prefix, pluginSearchText).map((plugin, index) => ({
    label: AT_PREFIX + plugin.name,
    kind: CompletionItemKind.Module,
    detail: plugin.id,
    data: { type: CompletionType.Plugin, name: plugin.name },
    textEdit: replaceToken(position, tokenStart, AT_PREFIX + plugin.name),
    ...completionMetadata(
      AT_PREFIX + prefix,
      index,
      CompletionSortGroup.Plugin,
    ),
  }));
}

export function getFileCompletions(
  position: Position,
  tokenStart: number,
  prefix: string,
  rootPath: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];

  try {
    const matches = getFileFinder(rootPath).find(prefix);
    for (const [index, match] of matches.entries()) {
      const entry = match.item;
      items.push({
        label: AT_PREFIX + abbreviatedPath(entry.relPath),
        kind: entry.isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
        detail: entry.relPath,
        data: { type: CompletionType.File, path: entry.relPath },
        // Selecting a file mention consumes the `@` and writes the whole
        // path — the sigil is prompt state in the Codex composer, not text.
        textEdit: replaceToken(position, tokenStart, entry.relPath),
        ...completionMetadata(
          AT_PREFIX + prefix,
          index,
          CompletionSortGroup.File,
        ),
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
    if (isIgnoredEntry(entry)) continue;
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

function isIgnoredEntry(entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name);
  if (!entry.isFile()) return false;
  return (
    IGNORED_FILES.has(entry.name) ||
    IGNORED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
  );
}

// Typing `@src/com…` fires one completion request per keystroke; the TTL
// keeps only the first request on disk.
interface CachedFileFinder {
  expiresAt: number;
  finder: Fzf<DirEntry[]>;
}

const entryCache = new Map<string, CachedFileFinder>();
const ENTRY_CACHE_TTL_MS = 2000;
const ENTRY_CACHE_MAX = 16;

function getFileFinder(rootPath: string): Fzf<DirEntry[]> {
  const cached = entryCache.get(rootPath);
  if (cached && cached.expiresAt > Date.now()) return cached.finder;

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
    finder,
  });

  // Map iteration order is insertion order — evict the oldest.
  if (entryCache.size > ENTRY_CACHE_MAX) {
    const oldest = entryCache.keys().next().value;
    if (oldest !== undefined) entryCache.delete(oldest);
  }
  return finder;
}

function getMentionCompletions(
  prefix: string,
  position: Position,
  tokenStart: number,
  rootPath: string,
  skills: Skill[],
  plugins: Plugin[],
): CompletionItem[] {
  const pluginItems = getPluginCompletions(
    prefix,
    plugins,
    position,
    tokenStart,
  );
  const skillItems = getSkillCompletionsAt(
    position,
    tokenStart,
    prefix,
    skills,
  );

  // A bare `@` should show only known mention candidates. Avoid walking the
  // workspace until the user provides a file-search prefix.
  if (!prefix) return [...pluginItems, ...skillItems];

  return [
    ...pluginItems,
    ...skillItems,
    ...getFileCompletions(position, tokenStart, prefix, rootPath),
  ];
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

  if (ctx.type === TriggerType.Slash) {
    return {
      isIncomplete: true,
      items: getSlashCompletions(ctx.prefix, commands, position, ctx.start),
    };
  }
  if (ctx.type === TriggerType.Skill) {
    return {
      isIncomplete: true,
      items: getSkillCompletions(ctx.prefix, skills, position, ctx.start),
    };
  }
  if (ctx.type === TriggerType.Mention) {
    return {
      isIncomplete: true,
      items: getMentionCompletions(
        ctx.prefix,
        position,
        ctx.start,
        rootPath,
        skills,
        plugins,
      ),
    };
  }

  return { isIncomplete: false, items: [] };
}
