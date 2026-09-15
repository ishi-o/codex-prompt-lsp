vim.opt.runtimepath:prepend(vim.fn.getcwd())

local buf = vim.api.nvim_create_buf(false, false)
vim.api.nvim_set_current_buf(buf)
local temp_dir = (vim.env.TMPDIR or "/tmp"):gsub("/+$", "")
vim.api.nvim_buf_set_name(buf, temp_dir .. "/.tmpCodexLspTest.md")
vim.bo[buf].filetype = "markdown"

require("nvim-codex-lsp").setup()
vim.wait(5000, function()
  return vim.bo[buf].filetype == "markdown.codex"
    and #vim.lsp.get_clients({ bufnr = buf, name = "codex_lsp" }) == 1
    and vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token"
end)

assert(vim.bo[buf].filetype == "markdown.codex")
local clients = vim.lsp.get_clients({ bufnr = buf, name = "codex_lsp" })
assert(#clients == 1)
assert(type(vim.tbl_get(clients[1].server_capabilities, "experimental", "codexCompletionTokens")) == "table")
assert(vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token")

local input_buf = vim.api.nvim_create_buf(false, false)
vim.api.nvim_set_current_buf(input_buf)
vim.api.nvim_buf_set_name(input_buf, "mini-codex://input")
vim.bo[input_buf].filetype = "markdown.codex"
vim.wait(5000, function()
  return #vim.lsp.get_clients({ bufnr = input_buf, name = "codex_lsp" }) == 1
    and vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token"
end)

assert(#vim.lsp.get_clients({ bufnr = input_buf, name = "codex_lsp" }) == 1)
assert(vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token")

print("startup buffer tests passed")
