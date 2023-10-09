# Git Worktree Assistant

This extension aims to make working with worktrees in VS Code easy and accessible, without having to
learn the command line interface for worktrees.

## WORK IN PROGRESS

This Extension is currently in its very early stages of development and contains a lot of bugs. Use it
at your onw risk.

## Features

### Add new worktrees

Use the Command Palette to create a new worktree with the `Add Worktree` command. It guides you through
the process of picking options or branches for your worktree and suggests a location. The default worktree
directory can be adjusted in the extension settings.

### Remove worktrees

Use the `Remove Worktree` command to choose an existing worktree from a list and remove it.

### Open a worktree in VS Code

Use the `Switch to Worktree` or `Open Worktree in New Window` commands to open the folder or workspace file of a worktree with VS Code.

## Requirements

Your Workspace needs to be a git repository and the `git` command has to be available on your system.

## Extension Settings

This extension contributes the following settings:

- `gitWorktreeAssistant.addWorktree.defaultWorktreeDirectory`: The path where worktrees are reccomended to be created (relative to repo root).
- `gitWorktreeAssistant.openWorktree.workspaceFileLocation`: The path where a `*.code-workspace` file can be found (relative to worktree root).

## Known Issues

If commands do not work for unknown reasons, consider updating your git installation. I used 2.42.0 for development.

## Release Notes

These Release Notes document major changes to the extension that change the major or minor version number, e.g. new features.

For all changes, see [the change log](CHANGELOG.md).

No releases yet... (I regard this as unreleased until major version 1)
