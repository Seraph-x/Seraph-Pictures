function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', value));
}

export async function createMultipartDigestPlan(file, chunkSize) {
  const partDigests = [];
  const totalParts = Math.ceil(file.size / chunkSize);
  for (let index = 0; index < totalParts; index += 1) {
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
    partDigests.push(await sha256(await chunk.arrayBuffer()));
  }
  const manifest = new TextEncoder().encode(partDigests.join(':'));
  return Object.freeze({
    rootDigest: await sha256(manifest),
    partDigests: Object.freeze(partDigests),
  });
}
