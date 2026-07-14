function readDirectory(entry, parentPath, resolve) {
  const reader = entry.createReader();
  const entries = [];
  function readBatch() {
    reader.readEntries(async (batch) => {
      if (batch.length) {
        entries.push(...batch);
        readBatch();
        return;
      }
      const base = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      const children = await Promise.all(entries.map((child) => readEntry(child, base)));
      resolve(children.flat());
    });
  }
  readBatch();
}

function readEntry(entry, parentPath) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => resolve([{
        file, relativePath: parentPath ? `${parentPath}/${file.name}` : file.name,
      }]));
      return;
    }
    if (!entry.isDirectory) {
      resolve([]);
      return;
    }
    readDirectory(entry, parentPath, resolve);
  });
}

export async function extractDroppedFiles(dataTransfer) {
  if (!dataTransfer?.items?.length) {
    return Array.from(dataTransfer?.files || []).map((file) => ({ file, relativePath: '' }));
  }
  const direct = [];
  const tasks = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) tasks.push(readEntry(entry, ''));
    else if (item.getAsFile?.()) direct.push({ file: item.getAsFile(), relativePath: '' });
  }
  const nested = await Promise.all(tasks);
  return [...direct, ...nested.flat()];
}
