local M = {}

local namespace = vim.api.nvim_create_namespace("nvim-codex-lsp-pasted-content")
local buffers = {}
local original_paste
local active_stream
local next_id = 0
local mini_codex_hooked = false
local wrapped_mini_buffers = {}

local function delete_target(target)
  if type(target) ~= "table" then
    return
  end
  if target.buf and vim.api.nvim_buf_is_valid(target.buf) then
    vim.api.nvim_buf_delete(target.buf, { force = true })
  end
  if target.path then
    vim.fn.delete(target.path)
  end
end

local function append_lines(target, lines)
  if #lines == 0 then
    return
  end
  if #target == 0 then
    vim.list_extend(target, lines)
    return
  end

  target[#target] = target[#target] .. lines[1]
  for index = 2, #lines do
    target[#target + 1] = lines[index]
  end
end

local function create_content_buffer(lines)
  next_id = next_id + 1
  local path = vim.fn.tempname() .. ("-codex-paste-%d.md"):format(next_id)
  if vim.fn.writefile(lines, path, "b") ~= 0 then
    return nil
  end

  local buf = vim.fn.bufadd(path)
  vim.fn.bufload(buf)
  vim.bo[buf].filetype = "text"
  vim.bo[buf].modifiable = false
  vim.bo[buf].swapfile = false
  return { id = next_id, buf = buf, path = path, lines = vim.deepcopy(lines) }
end

local function insert_placeholder(buf, lines)
  local state = buffers[buf]
  if not state then
    return original_paste(lines, -1)
  end

  local target = create_content_buffer(lines)
  if not target then
    return original_paste(lines, -1)
  end
  local content = table.concat(lines, "\n")
  local placeholder = ("[Pasted Content #%d %d lines %d chars]"):format(
    target.id,
    #lines,
    vim.fn.strchars(content)
  )

  local ok = original_paste({ placeholder }, -1)
  if ok == false or vim.api.nvim_get_current_buf() ~= buf then
    delete_target(target)
    return ok
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  local row, end_col = cursor[1] - 1, cursor[2]
  local start_col = end_col - #placeholder
  if start_col < 0 then
    delete_target(target)
    return ok
  end

  local id = vim.api.nvim_buf_set_extmark(buf, namespace, row, start_col, {
    end_row = row,
    end_col = end_col,
    end_right_gravity = false,
    invalidate = true,
    undo_restore = true,
  })
  state.pastes[id] = target
  return ok
end

local function should_capture()
  local buf = vim.api.nvim_get_current_buf()
  return buffers[buf] ~= nil and vim.api.nvim_get_mode().mode:match("^i") ~= nil, buf
end

local function paste(lines, phase)
  if phase == -1 then
    active_stream = nil
    local capture, buf = should_capture()
    if capture and #lines > 1 then
      return insert_placeholder(buf, lines)
    end
    return original_paste(lines, phase)
  end

  if phase == 1 then
    local capture, buf = should_capture()
    active_stream = capture and { buf = buf, lines = {} } or false
  end

  if active_stream == false then
    local ok = original_paste(lines, phase)
    if phase == 3 then
      active_stream = nil
    end
    return ok
  end

  if not active_stream then
    return original_paste(lines, phase)
  end

  append_lines(active_stream.lines, lines)
  if phase ~= 3 then
    return true
  end

  local stream = active_stream
  active_stream = nil
  if #stream.lines > 1 and buffers[stream.buf] then
    return insert_placeholder(stream.buf, stream.lines)
  end
  return original_paste(stream.lines, -1)
end

local function install_paste_handler()
  if original_paste then
    return
  end
  original_paste = vim.paste
  vim.paste = paste
end

function M.is_token(token)
  return type(token) == "string"
    and token:match("^%[Pasted Content #%d+ %d+ lines %d+ chars%]$") ~= nil
end

function M.resolve(params, client)
  local source_buf
  for buf in pairs(buffers) do
    if vim.api.nvim_buf_is_valid(buf) and vim.uri_from_bufnr(buf) == params.textDocument.uri then
      source_buf = buf
      break
    end
  end
  if not source_buf then
    return nil
  end

  local row = params.position.line
  local line = vim.api.nvim_buf_get_lines(source_buf, row, row + 1, false)[1]
  if not line then
    return nil
  end

  local ok, col = pcall(
    vim.str_byteindex,
    line,
    client.offset_encoding or "utf-16",
    params.position.character,
    false
  )
  if not ok then
    return nil
  end

  local marks = vim.api.nvim_buf_get_extmarks(source_buf, namespace, 0, -1, { details = true })
  for _, mark in ipairs(marks) do
    local id, start_row, start_col, details = mark[1], mark[2], mark[3], mark[4]
    if
      not details.invalid
      and start_row == row
      and details.end_row == row
      and start_col <= col
      and col < details.end_col
    then
      local target = buffers[source_buf].pastes[id]
      if type(target) == "table" and target.path and vim.fn.filereadable(target.path) == 1 then
        return {
          uri = vim.uri_from_fname(target.path),
          contents = table.concat(target.lines, "\n"),
          range = {
            start = { line = 0, character = 0 },
            ["end"] = { line = 0, character = 0 },
          },
        }
      end
    end
  end
  return nil
end

function M.expand(buf)
  local state = buffers[buf]
  if not state or not vim.api.nvim_buf_is_valid(buf) then
    return
  end

  local marks = vim.api.nvim_buf_get_extmarks(buf, namespace, 0, -1, { details = true })
  for index = #marks, 1, -1 do
    local mark = marks[index]
    local id, row, col, details = mark[1], mark[2], mark[3], mark[4]
    local target = state.pastes[id]
    if target and target.lines and not details.invalid then
      vim.api.nvim_buf_set_text(buf, row, col, details.end_row, details.end_col, target.lines)
    end
  end

  vim.api.nvim_buf_clear_namespace(buf, namespace, 0, -1)
  for _, target in pairs(state.pastes) do
    delete_target(target)
  end
  state.pastes = {}
end

local function install_mini_codex_hook(buf)
  local input = package.loaded["mini.codex.input"]
  if type(input) ~= "table" or type(input._apply) ~= "function" then
    return
  end

  if not mini_codex_hooked then
    mini_codex_hooked = true
    local apply = input._apply
    input._apply = function(...)
      local current = vim.api.nvim_get_current_buf()
      if buffers[current] then
        M.expand(current)
      end
      return apply(...)
    end
  end

  if wrapped_mini_buffers[buf] then
    return
  end
  for _, map in ipairs(vim.api.nvim_buf_get_keymap(buf, "n")) do
    local callback = map.callback
    local info = type(callback) == "function" and debug.getinfo(callback, "S") or nil
    if info and info.source and info.source:match("mini/codex/input%.lua$") then
      vim.keymap.set("n", map.lhs, function()
        M.expand(buf)
        return callback()
      end, {
        buffer = buf,
        desc = map.desc,
        nowait = map.nowait == 1,
        silent = map.silent == 1,
      })
      wrapped_mini_buffers[buf] = true
    end
  end
end

function M.setup(buf)
  if buffers[buf] then
    return
  end

  buffers[buf] = { pastes = {} }
  install_paste_handler()
  install_mini_codex_hook(buf)

  local group = vim.api.nvim_create_augroup("nvim-codex-lsp-pasted-" .. buf, { clear = true })
  vim.api.nvim_create_autocmd("BufWritePre", {
    group = group,
    buffer = buf,
    callback = function()
      M.expand(buf)
    end,
  })
  vim.api.nvim_create_autocmd("BufWipeout", {
    group = group,
    buffer = buf,
    callback = function()
      local state = buffers[buf]
      buffers[buf] = nil
      wrapped_mini_buffers[buf] = nil
      if state then
        for _, target in pairs(state.pastes) do
          delete_target(target)
        end
      end
    end,
  })
end

return M
