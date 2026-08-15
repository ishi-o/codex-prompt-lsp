.PHONY: build

build:
	cd server && npm ci && npm run build
