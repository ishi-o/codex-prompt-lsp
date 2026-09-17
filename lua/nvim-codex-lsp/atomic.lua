local M = {}

local configured_buffers = {}
local PASTED_TOKEN_PATTERN = "^%[Pasted Content #%d+ %d+ lines %d+ chars%]$"

local function is_pasted_token(token)
  return type(token) == "string" and token:match(PASTED_TOKEN_PATTERN) ~= nil
end

local function is_atomic_token(state, token)
  return state and (state.tokens[token] or (state.pasted_content and is_pasted_token(token)))
end

local function is_move_token(state, token)
  return state
    and type(token) == "string"
    and ((token:sub(1, 1) == "@")
      or (token:sub(1, 1) == "$" and not is_pasted_token(token))
      or (state.pasted_content and is_pasted_token(token)))
end

local function token_ranges(state, line)
  local ranges = {}

  local function collect(pattern)
    local offset = 1
    while true do
      local start_col, end_col = line:find(pattern, offset)
      if not start_col then
        break
      end

      local token = line:sub(start_col, end_col)
      local before = line:sub(start_col - 1, start_col - 1)
      local after = line:sub(end_col + 1, end_col + 1)
      local continuation = token:sub(1, 1) == "$" and "[A-Za-z0-9_-]"
        or token:sub(1, 1) == "@" and "[A-Za-z0-9._/-]"
      if
        is_move_token(state, token)
        and (before == "" or not before:match("[%w_]"))
        and (not continuation or after == "" or not after:match(continuation))
      then
        ranges[#ranges + 1] = {
          start_col = start_col - 1,
          end_col = end_col,
        }
      end
      offset = end_col + 1
    end
  end

  collect("%[Pasted Content #%d+ %d+ lines %d+ chars%]")
  collect("%$[A-Za-z][A-Za-z0-9_-]*")
  collect("@[A-Za-z0-9][A-Za-z0-9._/-]*")
  table.sort(ranges, function(left, right)
    return left.start_col < right.start_col
  end)
  return ranges
end

local function token_before_cursor(line, col)
  local prefix = line:sub(1, col)
  local token = prefix:match("(%[Pasted Content #%d+ %d+ lines %d+ chars%])$")
    or prefix:match("(%$[A-Za-z][A-Za-z0-9_-]*)$")
    or prefix:match("(@[A-Za-z0-9][A-Za-z0-9._/-]*)$")
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
  local continuation = token:sub(1, 1) == "$" and "[A-Za-z0-9_-]"
    or token:sub(1, 1) == "@" and "[A-Za-z0-9._/-]"
  if continuation and following ~= "" and following:match(continuation) then
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
  if is_atomic_token(configured_buffers[buf], token) then
    return string.rep("<BS>", vim.fn.strchars(token))
  end

  return "<BS>"
end

local function token_after_cursor(line, col)
  local suffix = line:sub(col + 1)
  local token = suffix:match("^(%[Pasted Content #%d+ %d+ lines %d+ chars%])")
    or suffix:match("^(%$[A-Za-z][A-Za-z0-9_-]*)")
    or suffix:match("^(@[A-Za-z0-9][A-Za-z0-9._/-]*)")
  if not token then
    return nil
  end

  -- Do not interpret a mention embedded in an identifier as a token.
  local preceding = line:sub(col, col)
  if preceding ~= "" and preceding:match("[%w_]") then
    return nil
  end

  -- A cursor in the middle of a mention should move one character at a time.
  local end_col = col + #token
  local following = line:sub(end_col + 1, end_col + 1)
  local continuation = token:sub(1, 1) == "$" and "[A-Za-z0-9_-]"
    or token:sub(1, 1) == "@" and "[A-Za-z0-9._/-]"
  if continuation and following ~= "" and following:match(continuation) then
    return nil
  end

  return token
end

local function atomic_move(buf, direction)
  local key = direction == "left" and "<Left>" or "<Right>"
  if vim.fn.pumvisible() == 1 then
    return key
  end

  local state = configured_buffers[buf]
  if not state then
    return key
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local row, col = cursor[1] - 1, cursor[2]
  local line = vim.api.nvim_buf_get_lines(buf, row, row + 1, false)[1]
  if not line then
    return key
  end

  local token = direction == "left" and token_before_cursor(line, col)
    or token_after_cursor(line, col)
  if is_move_token(state, token) then
    return string.rep(key, vim.fn.strchars(token))
  end

  return key
end

local function keep_cursor_out(buf)
  local state = configured_buffers[buf]
  if not state or vim.api.nvim_get_current_buf() ~= buf then
    return
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local row, col = cursor[1] - 1, cursor[2]
  local line = vim.api.nvim_buf_get_lines(buf, row, row + 1, false)[1] or ""
  local insert_mode = vim.api.nvim_get_mode().mode:match("^i") ~= nil

  for _, range in ipairs(token_ranges(state, line)) do
    local left = range.start_col
    local right = insert_mode and range.end_col or math.max(range.end_col - 1, left)
    if left < col and col < right then
      local previous = state.cursor
      local target
      if previous and previous.row == row then
        target = previous.col <= left and right or left
      else
        target = col - left < right - col and left or right
      end
      vim.api.nvim_win_set_cursor(0, { row + 1, target })
      col = target
      break
    end
  end

  state.cursor = { row = row, col = col }
end

function M.setup(buf, completion_tokens, opts)
  if configured_buffers[buf] then
    return
  end

  opts = opts or {}
  local tokens = {}
  completion_tokens = type(completion_tokens) == "table" and completion_tokens or {}
  for _, token in ipairs(completion_tokens) do
    if type(token) == "string" then
      tokens[token] = true
    end
  end
  configured_buffers[buf] = {
    tokens = tokens,
    pasted_content = opts.pasted_content ~= false,
    cursor = vim.api.nvim_get_current_buf() == buf
      and { row = vim.api.nvim_win_get_cursor(0)[1] - 1, col = vim.api.nvim_win_get_cursor(0)[2] }
      or nil,
  }

  local group = vim.api.nvim_create_augroup("nvim-codex-lsp-atomic-" .. buf, { clear = true })
  vim.api.nvim_create_autocmd("BufWipeout", {
    group = group,
    buffer = buf,
    callback = function()
      configured_buffers[buf] = nil
    end,
  })

  if opts.cursor ~= false then
    vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "ModeChanged" }, {
      group = group,
      buffer = buf,
      callback = function()
        keep_cursor_out(buf)
      end,
    })
  end

  if opts.backspace ~= false then
    vim.keymap.set("i", "<BS>", function()
      return atomic_backspace(buf)
    end, {
      buffer = buf,
      expr = true,
      replace_keycodes = true,
      desc = "Delete a Codex mention as one token",
    })
  end

  if opts.move ~= false then
    vim.keymap.set("i", "<Left>", function()
      return atomic_move(buf, "left")
    end, {
      buffer = buf,
      expr = true,
      replace_keycodes = true,
      desc = "Move across a Codex mention as one token",
    })
    vim.keymap.set("i", "<Right>", function()
      return atomic_move(buf, "right")
    end, {
      buffer = buf,
      expr = true,
      replace_keycodes = true,
      desc = "Move across a Codex mention as one token",
    })
  end
end

-- Exposed for headless tests.
M._token_before_cursor = token_before_cursor
M._atomic_backspace = atomic_backspace
M._token_after_cursor = token_after_cursor
M._atomic_move = atomic_move
M._keep_cursor_out = keep_cursor_out

return M
