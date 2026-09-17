vim.opt.runtimepath:prepend(vim.fn.getcwd())

local atomic = require("nvim-codex-lsp.atomic")

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

vim.api.nvim_win_set_cursor(0, { 1, 0 })
assert(atomic._atomic_move(move_buf, "right") == string.rep("<Right>", #"@openai-templates"))

vim.api.nvim_buf_set_lines(move_buf, 0, -1, false, { "Use /command!" })
vim.api.nvim_win_set_cursor(0, { 1, #"Use /command" })
assert(atomic._atomic_move(move_buf, "left") == "<Left>")

print("atomic completion tests passed")
