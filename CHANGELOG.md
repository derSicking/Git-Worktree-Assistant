# Change Log

All notable changes to the **Git Worktree Assistant** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.5

### Fixed

- Removed stray ':' at the end of displayed commit messages.

## 0.1.4

### Added

- More progress indicators for (potentially) long running processes.

## 0.1.3

### Fixed

- Removed git calls from repo root due to bugs.
- Fixed incorrect 'not in a git repo' error messages.

## 0.1.2

### Fixed

- The README and CHANGELOG were inaccurate about major version 0.
- Branches with commits with certain characters in their messages prevented adding worktrees.
- Add alternative way to determine the repo root directory for systems with old git versions (with no `--path-format=absolute` option).

## 0.1.1

### Fixed

- When selecting a worktree, there was an empty selection.
- The default file extension for workspace files was `*.workspace` instead of `*.code-workspace`.

## 0.1.0

### Added

- `Add Worktree` command that allows users to add new worktrees and check out new or existing branches.
- `Remove Worktree` command to choose and remove a worktree.
- `Switch to Worktree` and `Open Worktree in New Window` commands to Change the VS Code Workspace.
