vim.opt.runtimepath:prepend(vim.fn.getcwd())

local atomic = require("nvim-codex-lsp.atomic")
local pasted = require("nvim-codex-lsp.pasted")

local function token(text)
  return atomic._token_before_cursor(text, #text)
end

assert(token("$imagegen") == "$imagegen")
assert(token("Use $imagegen") == "$imagegen")
assert(token("@openai-templates") == "@openai-templates")
assert(token("See (@src/completion.ts") == "@src/completion.ts")
assert(token("me@example.com") == nil)
assert(token("prefix$skill") == nil)
assert(token("ordinary") == nil)
assert(token("$") == nil)
assert(token("[Pasted Content #1 2 lines 11 chars]") == "[Pasted Content #1 2 lines 11 chars]")
assert(token("[Pasted Content #1 2 lines 11 char") == nil)
assert(atomic._token_before_cursor("Use $imagegen", #"Use $image") == nil)
assert(atomic._token_before_cursor("Use @openai-templates", #"Use @openai") == nil)

local buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(buf)
atomic.setup(buf, { "$imagegen", "@openai-templates" })

-- Exercise the expression mapping itself, with ! keeping Normal-mode's cursor
-- at the insertion point immediately after the completion token.
vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Use @openai-templates!" })
vim.api.nvim_win_set_cursor(0, { 1, #"Use @openai-templates" })
local keys = vim.api.nvim_replace_termcodes("i<BS><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_get_current_line() == "Use !")

vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Use $imagegen!" })
vim.api.nvim_win_set_cursor(0, { 1, #"Use $imagegen" })
keys = vim.api.nvim_replace_termcodes("i<BS><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_get_current_line() == "Use !")

vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Use $imageg!" })
vim.api.nvim_win_set_cursor(0, { 1, #"Use $imageg" })
keys = vim.api.nvim_replace_termcodes("i<BS><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_get_current_line() == "Use $image!")

local move_buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(move_buf)
atomic.setup(move_buf, { "$imagegen", "@openai-templates" })
assert(vim.fn.maparg("<Left>", "i", false, true).desc == "Move across a Codex mention as one token")
assert(vim.fn.maparg("<Right>", "i", false, true).desc == "Move across a Codex mention as one token")

vim.api.nvim_buf_set_lines(move_buf, 0, -1, false, { "@openai-templates!" })
vim.api.nvim_win_set_cursor(0, { 1, #"@openai-templates" })
assert(atomic._atomic_move(move_buf, "left") == string.rep("<Left>", #"@openai-templates"))
keys = vim.api.nvim_replace_termcodes("i<Left><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_win_get_cursor(0)[2] == 0)

vim.api.nvim_win_set_cursor(0, { 1, 0 })
assert(atomic._atomic_move(move_buf, "right") == string.rep("<Right>", #"@openai-templates"))
keys = vim.api.nvim_replace_termcodes("i<Right><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_win_get_cursor(0)[2] == #"@openai-templates" - 1)

vim.api.nvim_buf_set_lines(move_buf, 0, -1, false, { "@unknown $custom /command!" })
vim.api.nvim_win_set_cursor(0, { 1, 8 })
assert(atomic._atomic_move(move_buf, "left") == string.rep("<Left>", #"@unknown"))
vim.api.nvim_win_set_cursor(0, { 1, 9 })
assert(atomic._atomic_move(move_buf, "right") == string.rep("<Right>", #"$custom"))

vim.api.nvim_buf_set_lines(move_buf, 0, -1, false, { "Use /command!" })
vim.api.nvim_win_set_cursor(0, { 1, #"Use /command" })
assert(atomic._atomic_move(move_buf, "left") == "<Left>")

local paste_buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(paste_buf)
atomic.setup(paste_buf, {}, { pasted_content = true })
pasted.setup(paste_buf)
vim.api.nvim_buf_set_lines(paste_buf, 0, -1, false, { "!" })
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.keymap.set("i", "<C-L>", function()
  vim.api.nvim_paste("hello\nworld", false, -1)
end, { buffer = paste_buf })
keys = vim.api.nvim_replace_termcodes("i<C-L><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
local pasted_token = "[Pasted Content #1 2 lines 11 chars]"
assert(vim.api.nvim_get_current_line() == pasted_token .. "!")
vim.api.nvim_win_set_cursor(0, { 1, #pasted_token })
local move_result = atomic._atomic_move(paste_buf, "left")
assert(move_result == string.rep("<Left>", #pasted_token))

local location = pasted.resolve({
  textDocument = { uri = vim.uri_from_bufnr(paste_buf) },
  position = { line = 0, character = 2 },
}, { offset_encoding = "utf-16" })
assert(location ~= nil)
assert(vim.api.nvim_buf_get_lines(vim.uri_to_bufnr(location.uri), 0, -1, false)[1] == "hello")
assert(vim.api.nvim_buf_get_lines(vim.uri_to_bufnr(location.uri), 0, -1, false)[2] == "world")

vim.api.nvim_win_set_cursor(0, { 1, #pasted_token })
keys = vim.api.nvim_replace_termcodes("i<BS><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_get_current_line() == "!")

vim.cmd("undo")
assert(vim.api.nvim_get_current_line() == pasted_token .. "!")
local restored_location = pasted.resolve({
  textDocument = { uri = vim.uri_from_bufnr(paste_buf) },
  position = { line = 0, character = 2 },
}, { offset_encoding = "utf-16" })
assert(restored_location ~= nil)
assert(vim.api.nvim_buf_get_lines(vim.uri_to_bufnr(restored_location.uri), 0, -1, false)[1] == "hello")
assert(vim.api.nvim_buf_get_lines(vim.uri_to_bufnr(restored_location.uri), 0, -1, false)[2] == "world")

vim.api.nvim_buf_set_lines(paste_buf, 0, -1, false, { "!" })
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.keymap.set("i", "<C-K>", function()
  vim.api.nvim_paste("alpha\nbe", false, 1)
  vim.api.nvim_paste("ta", false, 3)
end, { buffer = paste_buf })
keys = vim.api.nvim_replace_termcodes("i<C-K><Esc>", true, false, true)
vim.api.nvim_feedkeys(keys, "xt", false)
assert(vim.api.nvim_get_current_line() == "[Pasted Content #2 2 lines 10 chars]!")
pasted.expand(paste_buf)
assert(vim.deep_equal(vim.api.nvim_buf_get_lines(paste_buf, 0, -1, false), { "alpha", "beta!" }))

print("atomic completion tests passed")
