.PHONY: build test

build:
	cd server && npm ci && npm run build

test:
	XDG_STATE_HOME=/tmp/nvim-codex-lsp-state NVIM_LOG_FILE=/tmp/nvim-codex-lsp-test.log nvim --clean --headless -u NONE -l tests/atomic.lua
	XDG_STATE_HOME=/tmp/nvim-codex-lsp-state NVIM_LOG_FILE=/tmp/nvim-codex-lsp-test.log nvim --clean --headless -u NONE -l tests/startup.lua
