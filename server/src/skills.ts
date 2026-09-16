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
function* walkSkillFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkillFiles(fullPath);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
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
  /** Display name — the part before `@` in the plugin id */
  name: string;
  /** Full plugin id, e.g. "linear@openai-curated" */
  id: string;
  description: string;
}

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
    const timer = setTimeout(() => {
      child.kill();
      resolve([]);
    }, 3000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) return resolve([]);
      try {
        const raw = JSON.parse(stdout);
        const installed: Array<Record<string, unknown>> = raw.installed ?? [];
        resolve(
          installed.map((p) => {
            const id = String(p.id ?? p.name ?? "");
            const display = String(p.display_name ?? p.name ?? id);
            return {
              name: display || id.split("@")[0],
              id,
              description: String(p.description ?? p.short_description ?? ""),
            };
          }),
        );
      } catch {
        resolve([]);
      }
    });
  });
}
