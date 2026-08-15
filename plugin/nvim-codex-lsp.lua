-- Auto-setup with defaults if user hasn't called setup() themselves.
-- This allows the plugin to work when added to runtimepath without explicit configuration.
if vim.g.codex_lsp_loaded then
  return
end
vim.g.codex_lsp_loaded = true

vim.schedule(function()
  if not vim.g.codex_lsp_configured then
    require("nvim-codex-lsp").setup()
  end
end)
