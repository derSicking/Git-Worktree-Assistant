import { ChildProcess, exec, spawn, spawnSync } from "child_process";
import { error } from "console";
import { get } from "http";
import * as vscode from "vscode";

interface GitRef {
  source: "local" | "remote";
  id: string;
  name: string;
  upstream?: string;
  isHead: boolean;
  author: string;
  message: string;
  date: Date;
  ahead?: number;
  behind?: number;
  worktree?: Worktree;
}

interface PickableGitRef extends vscode.QuickPickItem {
  option?: "new" | "detached";
  ref?: GitRef;
}

interface Worktree {
  path: string;
  head?: string;
  branch?: string;
}

const config = vscode.workspace.getConfiguration("gitWorktreeAssistant");

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand("git-worktree-assistant.addWorktree", async () => {
    const shouldFetchSelection = await vscode.window.showQuickPick(["Yes", "No"], {
      title: "Do you want to fetch info on remote branches now?",
      canPickMany: false,
      placeHolder: "Fetch? Yes / No (Your working tree will not be affected)",
    });

    if (!shouldFetchSelection) {
      return;
    }

    const shouldFetch = shouldFetchSelection === "Yes";

    if (shouldFetch) {
      await gitFetch();
    }

    const allBranches = await getAllBranches();
    if (!allBranches) {
      return;
    }

    let selectableDestinationBranches: PickableGitRef[] = [
      {
        label: "New Branch",
        detail: "Checkout a new branch on the new worktree, similar to the -b option.",
        alwaysShow: true,
        iconPath: new vscode.ThemeIcon("gist-new"),
        option: "new",
      },
      {
        label: "Detached worktree",
        detail: "Create a worktree with a detached HEAD, without a new branch.",
        alwaysShow: true,
        iconPath: new vscode.ThemeIcon("git-pull-request-draft"),
        option: "detached",
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...filterUniqueBranches(allBranches).map<PickableGitRef>(makePickable),
    ];
    const destinationBranchSelection = await vscode.window.showQuickPick(selectableDestinationBranches, {
      matchOnDescription: true,
      title: "Which branch do you want to check out?",
      placeHolder: "Choose a branch to work on or create a new one.",
    });
    if (!destinationBranchSelection) {
      return;
    }

    // TODO: if an existing branch with an existing worktree was chosen offer to switch

    let baseBranchSelection: PickableGitRef | undefined = undefined;
    let baseCommitHash: string | undefined = undefined;
    let branchName: string | undefined = destinationBranchSelection.ref?.name;
    let shortenedBranchName = branchName;

    if (!destinationBranchSelection.ref?.upstream) {
      // if dest is a remote branch, remove the remote name (up to first /) from the branch name
      shortenedBranchName = branchName?.substring(branchName.indexOf("/") + 1);
    }

    if (destinationBranchSelection.option) {
      // get the base branch
      const head = allBranches.find((ref) => ref.isHead);
      let selectableBaseBranches: PickableGitRef[] = [
        ...(head ? [makePickable(head)] : []),
        { label: "Enter custom commit", alwaysShow: true, option: "new" },
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        ...allBranches.filter((ref) => !ref.isHead).map<PickableGitRef>(makePickable),
      ];
      baseBranchSelection = await vscode.window.showQuickPick(selectableBaseBranches, {
        matchOnDescription: true,
        title: "Which branch do you want to branch off of?",
        placeHolder: "Choose a branch.",
      });
      if (!baseBranchSelection) {
        return;
      }

      if (baseBranchSelection.option === "new") {
        // get commit hash from user
        baseCommitHash = await vscode.window.showInputBox({ title: "Which commit do you want to base the worktree on?", prompt: "Type in the commit hash." });
        if (!baseCommitHash) {
          return;
        }
        baseCommitHash = baseCommitHash.trim();
        if (!(await isValidCommit(baseCommitHash))) {
          vscode.window.showErrorMessage('The commit "' + baseCommitHash + '" is invalid.');
          return;
        }
      } else {
        baseCommitHash = baseBranchSelection.ref?.id;
      }
    }

    if (destinationBranchSelection.option === "new") {
      // get name for new branch
      branchName = await vscode.window.showInputBox({ title: "What will the new branch be called?", prompt: "Type in the name of the new branch." });
      if (!branchName) {
        return;
      }
      branchName = branchName.trim();
      if (!(await isValidBranchName(branchName))) {
        vscode.window.showErrorMessage('"' + branchName + '" is not a valid branch name.');
        return;
      }
      shortenedBranchName = branchName;
    }

    // build path to worktree
    let parentPath: string = config.get("addWorktree.defaultWorktreeDirectory") || "";
    parentPath = parentPath.trim();
    if (parentPath.length > 0 && !parentPath.endsWith("/")) {
      parentPath = parentPath + "/";
    }
    let worktreePath = await vscode.window.showInputBox({
      title: "Where will the worktree go? (Relative to repo root)",
      prompt: "Type in the directory name for the worktree.",
      value: parentPath + getWorktreeName(shortenedBranchName, baseCommitHash),
    });
    if (!worktreePath) {
      return;
    }
    worktreePath = worktreePath.trim();
    const base = baseBranchSelection?.ref?.name ?? baseCommitHash;

    let addExitStatus: number | null = null;

    if (base && branchName) {
      // create new branch
      addExitStatus = await runAddWorktreeCommand("-b", branchName, worktreePath, base);
    } else if (branchName) {
      // checkout existing branch
      if (destinationBranchSelection.ref?.source === "local") {
        addExitStatus = await runAddWorktreeCommand(worktreePath, branchName);
      } else {
        // if branch is remote
        addExitStatus = await runAddWorktreeCommand("--track", "-b", shortenedBranchName!, worktreePath, branchName);
      }
    } else if (base) {
      // detach
      addExitStatus = await runAddWorktreeCommand("--detach", worktreePath, base);
    }

    if (addExitStatus === 0) {
      // TODO: offer to switch to new worktree
    }
  });

  context.subscriptions.push(disposable);
}

async function runAddWorktreeCommand(...args: string[]) {
  const gitProcess = spawn("git", ["worktree", "add", ...args], { cwd: await getRootDirectory() });
  let stderr = "";
  gitProcess.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  return new Promise<number | null>((resolve) => {
    gitProcess.on("close", (exitCode) => {
      if (exitCode !== 0) {
        vscode.window.showErrorMessage("Adding worktree failed! " + stderr);
        resolve(exitCode);
      }
    });
  });
}

async function gitFetch() {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Fetching..." }, async (progress) => {
    return await awaitCommand("git fetch --all");
  });
}

function getWorktreeName(branchName: string | undefined, baseCommitHash: string | undefined): string {
  if (branchName) {
    return branchName;
  }
  return "detached-" + baseCommitHash;
}

function makePickable(ref: GitRef): PickableGitRef {
  return {
    label: ref.name,
    description:
      (ref.worktree ? "already exists " : "") +
      (ref.isHead ? "(HEAD) " : "") +
      (ref.ahead ? "↑" + ref.ahead + " " : "") +
      (ref.behind ? "↓" + ref.behind + " " : "") +
      (ref.upstream ? "[" + ref.upstream + "] " : "") +
      ref.id,
    detail: ref.author + ": " + ref.message + " (" + timeAgo(ref.date) + ")",
    iconPath: new vscode.ThemeIcon("git-branch"),
    ref,
  };
}

function filterUniqueBranches(allBranches: GitRef[]) {
  let branches: GitRef[] = [];

  allBranches.forEach((ref) => {
    if (ref.upstream) {
      branches.push(ref);
      return;
    }

    if (!allBranches.find((one) => one.upstream === ref.name)) {
      branches.push(ref);
    }
  });
  return branches;
}

async function getAllBranches(): Promise<GitRef[] | undefined> {
  let branches: GitRef[] = [];
  let refs = await getAllRefs();
  if (!refs) {
    return undefined;
  }

  let loadingAheadBehindPromises: Promise<void>[] = [];
  refs.forEach(async (ref) => {
    if (ref.upstream) {
      branches.push(ref);
      return;
    }

    const localBranch = refs?.find((one) => one.upstream === ref.name);
    if (!localBranch || localBranch.id !== ref.id) {
      loadingAheadBehindPromises.push(loadAheadBehind(localBranch, ref));
      branches.push(ref);
    }
  });
  await Promise.all(loadingAheadBehindPromises);

  return branches;
}

async function loadAheadBehind(local: GitRef | undefined, remote: GitRef) {
  if (!local) {
    return;
  }
  const ahead = await getCommandOutput("git rev-list --left-only --count " + local.name + "..." + remote.name);
  const behind = await getCommandOutput("git rev-list --right-only --count " + local.name + "..." + remote.name);
  local.ahead = Number(ahead);
  local.behind = Number(behind);
  remote.behind = Number(ahead);
  remote.ahead = Number(behind);
}

async function getRootDirectory() {
  const path = await getCommandOutput("git rev-parse --path-format=absolute --git-common-dir");
  return path?.substring(0, path.lastIndexOf("/"));
}

function getCurrentWorkspaceDirectory() {
  if (vscode.workspace.workspaceFolders) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
}

const worktreeDirList: string[] = [];

async function isInsideWorktree(directory: string) {
  if (worktreeDirList.includes(directory)) {
    return true;
  }
  if ("true" === (await getCommandOutput("git rev-parse --is-inside-work-tree", directory))?.trim()) {
    worktreeDirList.push(directory);
    return true;
  }
  return false;
}

async function getCurrentWorktreeDirectory() {
  const workspaceDirectory = getCurrentWorkspaceDirectory();
  if (workspaceDirectory && (await isInsideWorktree(workspaceDirectory))) {
    return workspaceDirectory;
  }
  vscode.window.showErrorMessage("You need to be in a workspace or folder with a git repo for this to work!");
}

async function getAllRefs() {
  const forEachRefCommand =
    'git for-each-ref --sort=-authordate --format="%(objectname:short),%(refname:lstrip=2),%(upstream:lstrip=2),%(if)%(HEAD)%(then)true%(else)false%(end),%(authorname),%(subject),%(authordate:iso8601)"';
  const localLines = splitLines(await getCommandOutput(forEachRefCommand + ' "refs/heads"'))?.map((line) => {
    return { line, source: "local" as const };
  });
  if (!localLines) {
    return undefined;
  }
  const remoteLines = splitLines(await getCommandOutput(forEachRefCommand + ' "refs/remotes"'))?.map((line) => {
    return { line, source: "remote" as const };
  });
  if (!remoteLines) {
    return undefined;
  }

  let lines = [...localLines, ...remoteLines];

  let worktrees = await getAllWorktrees();

  let refs: GitRef[] = [];
  lines.forEach((ref) => {
    const refSplit = ref.line.split(",");
    refs.push({
      source: ref.source,
      id: refSplit[0],
      name: refSplit[1],
      upstream: refSplit[2].length > 0 ? refSplit[2] : undefined,
      isHead: refSplit[3] === "true",
      author: refSplit[4],
      message: refSplit[5],
      date: new Date(refSplit[6]),
      worktree: ref.source === "local" ? worktrees?.find((wt) => wt.branch === refSplit[1]) : undefined,
    });
  });

  return refs;
}

async function getAllWorktrees() {
  const lines = splitLines(await getCommandOutput("git worktree list --porcelain"), true);
  if (!lines) {
    return undefined;
  }

  let worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};
  lines.forEach((line) => {
    if (line.trim().length === 0) {
      worktrees.push(current as Worktree);
      current = {};
      return;
    }

    if (line.startsWith("worktree ")) {
      current.path = line.substring("worktree ".length).trim();
      return;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.substring("HEAD ".length).trim();
      return;
    }

    if (line.startsWith("branch ")) {
      current.branch = line.substring(line.indexOf("/") + 1);
      current.branch = current.branch.substring(current.branch.indexOf("/") + 1);
    }
  });

  return worktrees;
}

async function isValidCommit(hash: string): Promise<boolean> {
  const process = spawn("git", ["cat-file", "-t", hash], { cwd: await getCurrentWorktreeDirectory() });
  let stdout = "";
  process.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  return new Promise<boolean>((resolve, reject) => {
    process.on("close", (exitCode) => {
      if (stdout.trim() !== "commit") {
        resolve(false);
      }
      resolve(true);
    });
  });
}

async function isValidBranchName(name: string): Promise<boolean> {
  const process = spawn("git", ["check-ref-format", "--branch", name], { cwd: await getCurrentWorktreeDirectory() });
  return new Promise<boolean>((resolve, reject) => {
    process.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve(false);
      }
      resolve(true);
    });
  });
}

function splitLines(lines?: string, keepEmpty = false): string[] | undefined {
  return lines?.split("\n").filter((s) => keepEmpty || s.trim().length > 0);
}

async function getCommandOutput(command: string, workingDir?: string): Promise<string | undefined> {
  let output = undefined;
  await awaitProcess(
    exec(command, { cwd: workingDir ?? (await getCurrentWorktreeDirectory()) }, (error, stdout, stderr) => {
      if (error) {
        console.error("error: ", stderr);
        return;
      }
      output = stdout;
    })
  );
  return output;
}

async function awaitCommand(command: string, workingDir?: string) {
  return awaitProcess(exec(command, { cwd: workingDir ?? (await getCurrentWorktreeDirectory()) }));
}

function awaitProcess(process: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    process.on("error", reject);
    process.on("exit", resolve);
  });
}

function timeAgo(date: Date, locale = "en") {
  let value;
  const diff = (new Date().getTime() - date.getTime()) / 1000;
  const minutes = Math.floor(diff / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (years > 0) {
    value = rtf.format(0 - years, "year");
  } else if (months > 0) {
    value = rtf.format(0 - months, "month");
  } else if (days > 0) {
    value = rtf.format(0 - days, "day");
  } else if (hours > 0) {
    value = rtf.format(0 - hours, "hour");
  } else if (minutes > 0) {
    value = rtf.format(0 - minutes, "minute");
  } else {
    value = rtf.format(0 - diff, "second");
  }
  return value;
}

export function deactivate() {}
