local M = {}

local configured_buffers = {}

local function token_before_cursor(line, col)
  local prefix = line:sub(1, col)
  local token = prefix:match("(%$[A-Za-z][A-Za-z0-9_-]*)$") or prefix:match("(@[A-Za-z0-9][A-Za-z0-9._/-]*)$")
  if not token then
    return nil
  end

  -- Do not interpret the tail of an identifier or email address as a mention.
  local start_col = #prefix - #token + 1
  local preceding = prefix:sub(start_col - 1, start_col - 1)
  if preceding ~= "" and preceding:match("[%w_]") then
    return nil
  end

  -- A cursor in the middle of a mention should delete only one character.
  local following = line:sub(col + 1, col + 1)
  local continuation = token:sub(1, 1) == "$" and "[A-Za-z0-9_-]" or "[A-Za-z0-9._/-]"
  if following ~= "" and following:match(continuation) then
    return nil
  end

  return token
end

local function atomic_backspace(buf)
  -- While selecting a completion, Backspace should continue refining its
  -- prefix one character at a time.
  if vim.fn.pumvisible() == 1 then
    return "<BS>"
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local row, col = cursor[1] - 1, cursor[2]
  if col == 0 then
    return "<BS>"
  end

  local line = vim.api.nvim_buf_get_lines(buf, row, row + 1, false)[1]
  local token = line and token_before_cursor(line, col)
  if token and configured_buffers[buf].tokens[token] then
    return string.rep("<BS>", vim.fn.strchars(token))
  end

  return "<BS>"
end

function M.setup(buf, completion_tokens)
  if configured_buffers[buf] then
    return
  end

  local tokens = {}
  completion_tokens = type(completion_tokens) == "table" and completion_tokens or {}
  for _, token in ipairs(completion_tokens) do
    if type(token) == "string" then
      tokens[token] = true
    end
  end
  configured_buffers[buf] = { tokens = tokens }

  vim.api.nvim_create_autocmd("BufWipeout", {
    group = vim.api.nvim_create_augroup("nvim-codex-lsp-atomic-" .. buf, { clear = true }),
    buffer = buf,
    callback = function()
      configured_buffers[buf] = nil
    end,
  })

  vim.keymap.set("i", "<BS>", function()
    return atomic_backspace(buf)
  end, {
    buffer = buf,
    expr = true,
    replace_keycodes = true,
    desc = "Delete a Codex mention as one token",
  })
end

-- Exposed for headless tests.
M._token_before_cursor = token_before_cursor
M._atomic_backspace = atomic_backspace

return M
