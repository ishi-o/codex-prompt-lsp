import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { SlashCommand } from "./commands";

/** Resolve $CODEX_HOME, defaulting to ~/.codex as Codex itself does. */
export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/** Parse YAML frontmatter from a markdown file. Returns null if none found. */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    // Strip surrounding quotes if present
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && value) result[key] = value;
  }
  return result;
}

/** Walk a directory recursively, yielding SKILL.md file paths. */
function* walkSkillFiles(
  dir: string,
  visitedRealPaths = new Set<string>(),
): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    let info: fs.Stats;
    try {
      info = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      let realPath: string;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        continue;
      }
      if (visitedRealPaths.has(realPath)) continue;
      visitedRealPaths.add(realPath);
      yield* walkSkillFiles(fullPath, visitedRealPaths);
    } else if (info.isFile() && entry.name === "SKILL.md") {
      yield fullPath;
    }
  }
}

export interface Skill {
  /** Skill name — mentioned as `$name` in the Codex composer */
  name: string;
  description: string;
  /** Directory containing the SKILL.md */
  dir: string;
}

/**
 * Discover Codex skills from (in priority order):
 *   1. <projectDir>/.codex/skills/ — repo skills (highest priority)
 *   2. $CODEX_HOME/skills/         — user skills (CODEX_HOME defaults to ~/.codex)
 *
 * Each skill is a directory containing a SKILL.md with `name`/`description`
 * frontmatter. Higher-priority skills override lower-priority ones with the
 * same name.
 */
export function discoverSkills(projectDir?: string): Skill[] {
  const skills: Skill[] = [];
  const seen = new Set<string>();

  const roots: string[] = [];
  if (projectDir) {
    roots.push(path.join(projectDir, ".codex", "skills"));
  }
  roots.push(path.join(codexHome(), "skills"));

  for (const root of roots) {
    for (const filePath of walkSkillFiles(root)) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      // The frontmatter name is authoritative; fall back to the directory name.
      const name = fm?.name ?? path.basename(path.dirname(filePath));
      if (!name || seen.has(name)) continue;
      seen.add(name);

      skills.push({
        name,
        description: fm?.description ?? "",
        dir: path.dirname(filePath),
      });
    }
  }

  return skills;
}

/**
 * Discover custom prompts from $CODEX_HOME/prompts/.
 * Codex scans only top-level .md files there; each is invoked as `/<filename>`.
 */
export function discoverCustomPrompts(): SlashCommand[] {
  const promptsDir = path.join(codexHome(), "prompts");
  const prompts: SlashCommand[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(promptsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    let content: string;
    try {
      content = fs.readFileSync(path.join(promptsDir, entry.name), "utf8");
    } catch {
      continue;
    }

    const cmdName = "/" + path.basename(entry.name, ".md");
    const desc = parseFrontmatter(content)?.description ?? "Custom prompt";
    prompts.push({
      name: cmdName,
      detail: desc,
      documentation: `**${cmdName}**\n\n${desc}`,
    });
  }

  return prompts;
}

export interface Plugin {
  /** Canonical mention name used when inserting a plugin mention. */
  name: string;
  /** Human-readable catalog title used for fuzzy search. */
  title: string;
  /** Alternate names accepted as fuzzy-search aliases. */
  aliases: string[];
  /** Full plugin id, e.g. "linear@openai-curated" */
  id: string;
  description: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function readJsonRecord(filePath: string): JsonRecord | undefined {
  try {
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

function listDirectories(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

/** Read a cached plugin manifest when the CLI list omits display metadata. */
function findCachedPluginManifest(pluginName: string): JsonRecord | undefined {
  if (!pluginName || path.basename(pluginName) !== pluginName) return undefined;

  const cacheRoot = path.join(codexHome(), "plugins", "cache");
  for (const marketplace of listDirectories(cacheRoot)) {
    const pluginRoot = path.join(cacheRoot, marketplace.name, pluginName);
    const versions = listDirectories(pluginRoot).sort((left, right) =>
      right.name.localeCompare(left.name),
    );
    for (const version of versions) {
      const manifestPath = path.join(
        pluginRoot,
        version.name,
        ".codex-plugin",
        "plugin.json",
      );
      const manifest = readJsonRecord(manifestPath);
      if (manifest) return manifest;
    }
  }

  return undefined;
}

const pluginManifestCache = new Map<string, JsonRecord | null>();

function readCachedPluginManifest(pluginName: string): JsonRecord | undefined {
  if (pluginManifestCache.has(pluginName)) {
    return pluginManifestCache.get(pluginName) ?? undefined;
  }

  const manifest = findCachedPluginManifest(pluginName);
  pluginManifestCache.set(pluginName, manifest ?? null);
  return manifest;
}

function titleCasePluginName(name: string): string {
  return name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-");
}

function firstString(...values: unknown[]): string {
  return (
    values.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    ) ?? ""
  );
}

interface PluginMetadata {
  displayName: string;
  description: string;
}

function getPluginMetadata(
  plugin: JsonRecord,
  cachedManifest: JsonRecord | undefined,
): PluginMetadata {
  const pluginInterface = asRecord(plugin.interface);
  const release = asRecord(plugin.release);
  const releaseInterface = asRecord(release?.interface);
  const cachedInterface = asRecord(cachedManifest?.interface);

  return {
    displayName: firstString(
      plugin.display_name,
      plugin.displayName,
      plugin.title,
      release?.display_name,
      release?.displayName,
      release?.title,
      pluginInterface?.displayName,
      pluginInterface?.display_name,
      pluginInterface?.title,
      releaseInterface?.displayName,
      releaseInterface?.display_name,
      releaseInterface?.title,
      cachedManifest?.display_name,
      cachedManifest?.displayName,
      cachedManifest?.title,
      cachedInterface?.displayName,
      cachedInterface?.display_name,
      cachedInterface?.title,
    ),
    description: firstString(
      plugin.description,
      plugin.short_description,
      plugin.shortDescription,
      release?.description,
      release?.short_description,
      release?.shortDescription,
      releaseInterface?.shortDescription,
      releaseInterface?.short_description,
      pluginInterface?.shortDescription,
      pluginInterface?.short_description,
      cachedManifest?.description,
      cachedManifest?.short_description,
      cachedManifest?.shortDescription,
      cachedInterface?.shortDescription,
      cachedInterface?.short_description,
    ),
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function createPlugin(raw: JsonRecord): Plugin | undefined {
  const id = firstString(raw.id, raw.name);
  const stableName = firstString(raw.name, id.split("@")[0]);
  if (!id || !stableName) return undefined;

  const cachedManifest = readCachedPluginManifest(stableName);
  const metadata = getPluginMetadata(raw, cachedManifest);
  const name = titleCasePluginName(stableName);

  return {
    name,
    title: metadata.displayName,
    aliases: uniqueNonEmpty([
      stableName,
      id.split("@")[0],
      name,
      metadata.displayName,
    ]),
    id,
    description: metadata.description,
  };
}

function parseInstalledPlugins(stdout: string): Plugin[] {
  try {
    const raw = asRecord(JSON.parse(stdout));
    if (!raw || !Array.isArray(raw.installed)) return [];

    return raw.installed
      .filter(isRecord)
      .map(createPlugin)
      .filter((plugin): plugin is Plugin => plugin !== undefined);
  } catch {
    return [];
  }
}

const PLUGIN_DISCOVERY_TIMEOUT_MS = 3000;

/**
 * Run `codex plugin list --json` and resolve installed plugins.
 * `@plugin` mentions in the composer target installed plugins.
 * Resolves to an empty list if the CLI is unavailable, exits non-zero, or
 * times out.
 */
export function discoverPlugins(): Promise<Plugin[]> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["plugin", "list", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;

    const finish = (plugins: Plugin[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(plugins);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish([]);
    }, PLUGIN_DISCOVERY_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => finish([]));
    child.on("close", (code) => {
      finish(code === 0 ? parseInstalledPlugins(stdout) : []);
    });
  });
}
