function joinPath(base, extra) {
  const segments = [];
  for (const piece of [base, extra]) {
    for (const part of String(piece || '').replace(/\\/g, '/').split('/')) {
      const cleaned = part.trim();
      if (!cleaned || cleaned === '.') continue;
      if (cleaned === '..') segments.pop();
      else segments.push(cleaned);
    }
  }
  return segments.join('/');
}

async function run(context, options) {
  context.error.value = '';
  try {
    await options.operation();
    await (options.refresh || context.refreshAll)();
  } catch (cause) {
    context.error.value = cause.message || context.t(options.errorKey);
  }
}

function updatePathAfterMove(context, source, target) {
  const current = context.currentPath.value;
  if (current === source || current.startsWith(`${source}/`)) {
    context.currentPath.value = current.replace(source, target);
  }
}

async function deleteFolderAction(context, folder) {
  if (!window.confirm(context.t('dv.confirmDeleteFolder', { name: folder.name }))) return;
  try {
    await context.api.deleteFolder(folder.path, false);
  } catch (cause) {
    if (!String(cause.message || '').includes('not empty')) {
      context.error.value = cause.message || context.t('dv.errDeleteFolder');
      return;
    }
    if (!window.confirm(context.t('dv.confirmDeleteRecursive'))) return;
    await context.api.deleteFolder(folder.path, true);
  }
  if (context.currentPath.value.startsWith(folder.path)) context.currentPath.value = '';
  await context.refreshAll();
}

function fileName(file) {
  return file.metadata?.fileName || file.name;
}

function folderActions(context) {
  async function createFolder() {
    const name = window.prompt(context.t('dv.promptFolderName'));
    if (!name) return;
    await run(context, {
      operation: () => context.api.createFolder(joinPath(context.currentPath.value, name)),
      errorKey: 'dv.errCreateFolder',
    });
  }
  async function renameFolder(folder) {
    const nextName = window.prompt(context.t('dv.promptRenameFolder'), folder.name);
    if (!nextName || nextName === folder.name) return;
    const target = joinPath(folder.parentPath || '', nextName);
    await run(context, {
      operation: async () => {
        await context.api.moveFolder(folder.path, target);
        updatePathAfterMove(context, folder.path, target);
      },
      errorKey: 'dv.errRenameFolder',
    });
  }
  async function moveFolder(folder) {
    const target = window.prompt(context.t('dv.promptMoveFolder'), folder.path);
    if (!target || target === folder.path) return;
    await run(context, {
      operation: async () => {
        await context.api.moveFolder(folder.path, target);
        updatePathAfterMove(context, folder.path, target);
      },
      errorKey: 'dv.errMoveFolder',
    });
  }
  return Object.freeze({
    createFolder, renameFolder, moveFolder,
    deleteFolder: (folder) => deleteFolderAction(context, folder),
  });
}

function fileActions(context) {
  async function renameFile(file) {
    const nextName = window.prompt(context.t('dv.promptRenameFile'), fileName(file));
    if (!nextName) return;
    await run(context, {
      operation: () => context.api.renameFile(file.name, nextName),
      errorKey: 'dv.errRename', refresh: context.reloadExplorer,
    });
  }
  async function moveFile(file) {
    const target = window.prompt(context.t('dv.promptMoveFile'), context.currentPath.value);
    if (target == null) return;
    await run(context, { operation: () => context.api.moveFiles([file.name], target), errorKey: 'dv.errMove' });
  }
  async function deleteFile(file) {
    if (!window.confirm(context.t('dv.confirmDeleteFile', { name: fileName(file) }))) return;
    await run(context, { operation: () => context.api.deleteFiles([file.name]), errorKey: 'dv.errDelete' });
  }
  return Object.freeze({ renameFile, moveFile, deleteFile });
}

function batchActions(context) {
  async function moveSelected() {
    const target = window.prompt(context.t('dv.promptMoveSelected'), context.currentPath.value);
    if (target == null) return;
    await run(context, {
      operation: async () => {
        await context.api.moveFiles(context.selectedFileIds.value, target);
        context.selectedFileIds.value = [];
      },
      errorKey: 'dv.errBatchMove',
    });
  }
  async function deleteSelected() {
    const ids = [...context.selectedFileIds.value];
    if (!ids.length || !window.confirm(context.t('dv.confirmDeleteSelected', { n: ids.length }))) return;
    await run(context, {
      operation: async () => {
        await context.api.deleteFiles(ids);
        context.selectedFileIds.value = [];
      },
      errorKey: 'dv.errBatchDelete',
    });
  }
  async function migrateSelected(destinationStorageId) {
    const ids = [...context.selectedFileIds.value];
    if (!ids.length) return;
    await run(context, {
      operation: async () => {
        await context.api.migrateFiles(ids, destinationStorageId);
        context.selectedFileIds.value = [];
      },
      errorKey: 'dv.errMigration',
    });
  }
  return Object.freeze({ moveSelected, deleteSelected, migrateSelected });
}

function linkActions(context) {
  async function copyDirect(file) {
    await navigator.clipboard.writeText(context.fileLink(file.name));
    context.message.value = context.t('dv.msgDirectCopied');
  }
  async function copyShare(file) {
    await run(context, {
      operation: async () => {
        const payload = await context.api.signShareLink(file.name);
        await navigator.clipboard.writeText(payload.shareUrl);
        const expires = payload.expiresAt
          ? new Date(payload.expiresAt).toLocaleString()
          : context.t('dv.expiresNever');
        context.message.value = context.t('dv.msgShareCopied', { permission: payload.permission, expireAt: expires });
      },
      errorKey: 'dv.errShareLink', refresh: async () => {},
    });
  }
  return Object.freeze({ copyDirect, copyShare });
}

export function useDriveMutations(options) {
  const context = Object.freeze({ ...options });
  return Object.freeze({
    ...folderActions(context), ...fileActions(context),
    ...batchActions(context), ...linkActions(context),
  });
}

export { joinPath };
