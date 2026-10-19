SHELL := /bin/bash
NPM ?= npm
ENTRY := dist-electron/main.js

.DEFAULT_GOAL := help

.PHONY: help install dev run compile build package lint verify clean distclean

help:
	@echo "Nova Tables — available targets:"
	@echo
	@printf '  %-10s %s\n' \
		install 'Install dependencies' \
		dev 'Run Vite with Electron and HMR (needs a display)' \
		run 'Run the built app (build it first)' \
		compile 'Build renderer, main and preload only (fast)' \
		build 'Build and package the app with installers' \
		package 'Build and package into release/<version>/linux-unpacked' \
		lint 'Lint the whole project' \
		verify 'Lint and compile, the check before calling work done' \
		clean 'Remove build output and packages' \
		distclean 'Also remove installed dependencies'

install:
	$(NPM) install

dev:
	$(NPM) run dev

run:
	@test -f $(ENTRY) || { echo "Missing $(ENTRY) — run 'make build' first."; exit 1; }
	$(NPM) start

compile:
	npx vite build

build:
	$(NPM) run build

package:
	$(NPM) run build:dir

lint:
	$(NPM) run lint

verify: lint compile

clean:
	rm -rf dist dist-electron release

distclean: clean
	rm -rf node_modules
