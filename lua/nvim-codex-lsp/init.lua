local M = {}

M.config = {
  node_cmd = "node",
}

-- vim.fs.sep requires Neovim 0.12+; fall back to the platform separator.
local path_sep = vim.fs.sep or package.config:sub(1, 1)

-- Define Codex-specific highlight groups (linked to standard groups by default).
-- Users can override these in their colorscheme or after/plugin/*.lua.
local function define_highlights()
  vim.api.nvim_set_hl(0, "CodexSlashCommand", { default = true, link = "Special" })
  vim.api.nvim_set_hl(0, "CodexSkillMention", { default = true, link = "Identifier" })
  vim.api.nvim_set_hl(0, "CodexPluginMention", { default = true, link = "Directory" })
end

-- Register the markdown treesitter parser for the markdown.codex compound
-- filetype so that markdown treesitter highlighting continues to work.
local function setup_treesitter()
  if vim.treesitter and vim.treesitter.language and vim.treesitter.language.register then
    pcall(vim.treesitter.language.register, "markdown", "markdown.codex")
  end
end

-- Add buffer-local syntax patterns for Codex-specific inline syntax.
-- These run on top of (or as fallback to) treesitter markdown highlighting.
local function setup_syntax(buf)
  vim.api.nvim_buf_call(buf, function()
    -- /command
    vim.cmd([[syntax match CodexSlashCommand "\v/[a-zA-Z][a-zA-Z0-9_-]*"]])
    -- $skill mentions
    vim.cmd([[syntax match CodexSkillMention "\v\$[a-zA-Z][a-zA-Z0-9_-]*"]])
    -- @plugin mentions
    vim.cmd([[syntax match CodexPluginMention "\v\@[a-zA-Z0-9._/-]+"]])
  end)
end

-- The Ctrl+G external editor buffer is a rust tempfile: `.tmpXXXXXX.md`
-- written to the system temp dir (no codex-specific prefix).
local function is_external_editor_buffer(filepath)
  local temp_dir = (vim.env.TMPDIR or "/tmp"):gsub("/+$", "")
  local name = vim.fs.basename(filepath)
  return filepath:gsub("/+$", ""):sub(1, #temp_dir) == temp_dir
    and name:match("^%.tmp[%w]+%.md$") ~= nil
end

---@param opts? {node_cmd?: string}
function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})
  vim.g.codex_lsp_configured = true

  define_highlights()
  setup_treesitter()

  -- Set filetype=markdown.codex on Codex buffers:
  --   1. Ctrl+G external editor buffer: `.tmpXXXXXX.md` in the temp dir
  --   2. $CODEX_HOME/**/*.md: skills (*/SKILL.md), custom prompts, AGENTS.md
  --   3. <any repo>/.codex/**/*.md: project-local skills
  -- Compound filetype: markdown syntax/treesitter still applies,
  -- but the LSP targets only this specific filetype.
  local home = vim.fn.expand("~")
  local codex_home = vim.env.CODEX_HOME or (home .. "/.codex")
  vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
    group = vim.api.nvim_create_augroup("nvim-codex-lsp-ft", { clear = true }),
    pattern = "*.md",
    callback = function(ev)
      local filepath = vim.api.nvim_buf_get_name(ev.buf)
      if not (
        is_external_editor_buffer(filepath)
        or filepath:sub(1, #codex_home + 1) == codex_home .. "/"
        or filepath:find(path_sep .. ".codex" .. path_sep, 1, true) ~= nil
      )
      then
        return
      end
      vim.bo[ev.buf].filetype = "markdown.codex"
      -- Schedule so syntax rules apply after the filetype event chain settles.
      vim.schedule(function()
        setup_syntax(ev.buf)
      end)
    end,
  })

  -- Resolve absolute path to dist/server.js relative to this file.
  -- This file lives at: lua/nvim-codex-lsp/init.lua
  -- server.js lives at: server/dist/server.js  (three :h steps up, then descend)
  local plugin_root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h:h:h")
  local server_js = plugin_root .. "/server/dist/server.js"

  vim.lsp.config("codex_lsp", {
    cmd = { M.config.node_cmd, server_js, "--stdio" },
    filetypes = { "markdown.codex" },
    root_dir = function(_bufnr, on_dir)
      on_dir(vim.fn.getcwd())
    end,
  })

  vim.lsp.enable("codex_lsp")
end

return M
