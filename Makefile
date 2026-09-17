.PHONY: build build-vscode package-vscode test

build:
	cd server && npm ci && npm run build

build-vscode: build
	cd vscode && npm ci && npm run typecheck && npm run build

package-vscode: build-vscode
	cd vscode && npm run package

test:
	XDG_STATE_HOME=/tmp/nvim-codex-lsp-state NVIM_LOG_FILE=/tmp/nvim-codex-lsp-test.log nvim --clean --headless -u NONE -l tests/atomic.lua
	XDG_STATE_HOME=/tmp/nvim-codex-lsp-state NVIM_LOG_FILE=/tmp/nvim-codex-lsp-test.log nvim --clean --headless -u NONE -l tests/startup.lua
	node tests/completions.js
