SHELL := /bin/bash
NPM ?= npm
ENTRY := dist-electron/main.js
VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null)
UNPACKED := release/$(VERSION)/linux-unpacked
ARTIFACTS := build/$(VERSION)
APP_DIR := $(HOME)/.local/opt/nova-tables
BIN_LINK := $(HOME)/.local/bin/nova-tables
APPLICATIONS := $(HOME)/.local/share/applications
LAUNCHER := $(APPLICATIONS)/nova-tables.desktop
DESKTOP_SHORTCUT := $(HOME)/Desktop/nova-tables.desktop
ICON_ROOT := $(HOME)/.local/share/icons/hicolor
ICON_SIZES := 16 24 32 48 64 128 256 512
IMAGE_MAGICK := $(shell command -v magick || command -v convert)

.DEFAULT_GOAL := help

.PHONY: help install dev run compile build build-linux build-win artifacts package deploy uninstall lint verify clean distclean

help:
	@echo
	@echo "Nova Tables — available targets:"
	@echo
	@printf '  %-11s %s\n' \
		install 'Install dependencies' \
		dev 'Run Vite with Electron and HMR (needs a display)' \
		run 'Run the built app (build it first)' \
		compile 'Build renderer, main and preload only (fast)' \
		build 'Build and package the app for Linux and Windows' \
		build-linux 'Build and package the Linux AppImage' \
		build-win 'Build and package the Windows installer' \
		artifacts 'Copy the installers into build/<version>/' \
		package 'Build and package into release/<version>/linux-unpacked' \
		deploy 'Build, remove any previous install, then install for the current user' \
		uninstall 'Remove the installed app, its desktop entry and icons' \
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

build-linux: compile
	npx electron-builder --linux

build-win: compile
	npx electron-builder --win

artifacts:
	@mkdir -p "$(ARTIFACTS)"
	@find release/$(VERSION) -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.exe' \) -exec cp -f {} "$(ARTIFACTS)/" \;
	@ls -1 "$(ARTIFACTS)" 2>/dev/null || echo "No installers found in release/$(VERSION) — run 'make build' first."

package:
	$(NPM) run build:dir

deploy: package
	@test -x "$(UNPACKED)/nova-tables" || { echo "Missing $(UNPACKED)/nova-tables — packaging failed."; exit 1; }
	rm -rf "$(APP_DIR)"
	rm -f "$(BIN_LINK)" "$(LAUNCHER)" "$(DESKTOP_SHORTCUT)"
	mkdir -p "$(APP_DIR)" "$(dir $(BIN_LINK))" "$(APPLICATIONS)"
	cp -a "$(UNPACKED)/." "$(APP_DIR)/"
	ln -s "$(APP_DIR)/nova-tables" "$(BIN_LINK)"
	mkdir -p "$(ICON_ROOT)/512x512/apps"
	if [ -n "$(IMAGE_MAGICK)" ]; then \
		for size in $(ICON_SIZES); do \
			mkdir -p "$(ICON_ROOT)/$${size}x$${size}/apps"; \
			$(IMAGE_MAGICK) public/logo.png -resize "$${size}x$${size}" "$(ICON_ROOT)/$${size}x$${size}/apps/nova-tables.png"; \
		done; \
	else \
		cp public/logo.png "$(ICON_ROOT)/512x512/apps/nova-tables.png"; \
	fi
	printf '%s\n' \
		'[Desktop Entry]' \
		'Type=Application' \
		'Name=Nova Tables' \
		'Comment=A modern desktop SQL client for Microsoft SQL Server.' \
		'Exec="$(APP_DIR)/nova-tables"' \
		'Icon=nova-tables' \
		'Terminal=false' \
		'Categories=Development;Database;' \
		'StartupWMClass=nova-tables' \
		> "$(LAUNCHER)"
	chmod +x "$(LAUNCHER)"
	@if [ -d "$(dir $(DESKTOP_SHORTCUT))" ]; then \
		cp "$(LAUNCHER)" "$(DESKTOP_SHORTCUT)"; \
		chmod +x "$(DESKTOP_SHORTCUT)"; \
		gio set "$(DESKTOP_SHORTCUT)" metadata::trusted true >/dev/null 2>&1 || true; \
	fi
	@update-desktop-database "$(APPLICATIONS)" >/dev/null 2>&1 || true
	@echo "Installed Nova Tables $(VERSION) in $(APP_DIR)"
	@echo "Launch it from the application menu or with: $(BIN_LINK)"

uninstall:
	rm -rf "$(APP_DIR)"
	rm -f "$(BIN_LINK)" "$(LAUNCHER)" "$(DESKTOP_SHORTCUT)"
	for size in $(ICON_SIZES); do rm -f "$(ICON_ROOT)/$${size}x$${size}/apps/nova-tables.png"; done
	@update-desktop-database "$(APPLICATIONS)" >/dev/null 2>&1 || true
	@echo "Removed Nova Tables from $(HOME)/.local"

lint:
	$(NPM) run lint

verify: lint compile

clean:
	rm -rf dist dist-electron release build

distclean: clean
	rm -rf node_modules
