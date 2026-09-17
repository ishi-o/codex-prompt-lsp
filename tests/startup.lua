vim.opt.runtimepath:prepend(vim.fn.getcwd())

local buf = vim.api.nvim_create_buf(false, false)
vim.api.nvim_set_current_buf(buf)
local temp_dir = (vim.env.TMPDIR or "/tmp"):gsub("/+$", "")
vim.api.nvim_buf_set_name(buf, temp_dir .. "/.tmpCodexLspTest.md")
vim.bo[buf].filetype = "markdown"

require("nvim-codex-lsp").setup()
vim.wait(5000, function()
  return vim.bo[buf].filetype == "markdown.codex"
    and #vim.lsp.get_clients({ bufnr = buf, name = "codex-prompt" }) == 1
    and vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token"
end)

assert(vim.bo[buf].filetype == "markdown.codex")
local clients = vim.lsp.get_clients({ bufnr = buf, name = "codex-prompt" })
assert(#clients == 1)
assert(clients[1].config.init_options.pastedContent == true)
assert(clients[1].server_capabilities.definitionProvider == true)
assert(type(vim.tbl_get(clients[1].server_capabilities, "experimental", "codexCompletionTokens")) == "table")
assert(vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token")

local input_buf = vim.api.nvim_create_buf(false, false)
vim.api.nvim_set_current_buf(input_buf)
vim.api.nvim_buf_set_name(input_buf, "mini-codex://input")
vim.bo[input_buf].filetype = "markdown.codex"
vim.wait(5000, function()
  return #vim.lsp.get_clients({ bufnr = input_buf, name = "codex-prompt" }) == 1
    and vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token"
end)

assert(#vim.lsp.get_clients({ bufnr = input_buf, name = "codex-prompt" }) == 1)
assert(vim.fn.maparg("<BS>", "i", false, true).desc == "Delete a Codex mention as one token")

vim.api.nvim_buf_set_lines(input_buf, 0, -1, false, { "!" })
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.keymap.set("i", "<C-L>", function()
  vim.api.nvim_paste("hello\nworld", false, -1)
end, { buffer = input_buf })
local keys = vim.api.nvim_replace_termcodes("i<C-L><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
local pasted_token = "[Pasted Content #1 2 lines 11 chars]"
assert(vim.api.nvim_get_current_line() == pasted_token .. "!")

local client = vim.lsp.get_clients({ bufnr = input_buf, name = "codex-prompt" })[1]
local request_error
local definition
client:request("textDocument/definition", {
  textDocument = { uri = vim.uri_from_bufnr(input_buf) },
  position = { line = 0, character = 2 },
}, function(err, result)
  request_error = err
  definition = result
end, input_buf)
vim.wait(5000, function()
  return request_error ~= nil or definition ~= nil
end)
assert(request_error == nil)
assert(definition ~= nil)
local definition_buf = vim.uri_to_bufnr(definition.uri)
assert(vim.api.nvim_buf_get_lines(definition_buf, 0, -1, false)[1] == "hello")
assert(vim.api.nvim_buf_get_lines(definition_buf, 0, -1, false)[2] == "world")

for _, character in ipairs({ 0, #pasted_token - 1 }) do
  local hover
  request_error = nil
  client:request("textDocument/hover", {
    textDocument = { uri = vim.uri_from_bufnr(input_buf) },
    position = { line = 0, character = character },
  }, function(err, result)
    request_error = err
    hover = result
  end, input_buf)
  vim.wait(5000, function()
    return request_error ~= nil or hover ~= nil
  end)
  assert(request_error == nil)
  assert(hover ~= nil)
  assert(hover.contents.value == "hello\nworld")
end

print("startup buffer tests passed")
