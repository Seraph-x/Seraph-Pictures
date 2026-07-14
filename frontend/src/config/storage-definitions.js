import capabilityModule from '../../../shared/storage/capabilities.cjs';

const { resolveCapability } = capabilityModule;

export const STORAGE_TYPES = [
  {
    value: 'telegram',
    label: 'Telegram',
    layer: 'direct',
    description: 'Simple and stable upload target.',
  },
  {
    value: 'r2',
    label: 'R2',
    layer: 'direct',
    description: 'Object storage for large files and CDN scenarios.',
  },
  {
    value: 's3',
    label: 'S3',
    layer: 'direct',
    description: 'Any S3-compatible storage service.',
  },
  {
    value: 'discord',
    label: 'Discord',
    layer: 'direct',
    description: 'Upload via webhook or bot to Discord.',
  },
  {
    value: 'huggingface',
    label: 'HuggingFace',
    layer: 'direct',
    description: 'Dataset repo as a lightweight storage backend.',
  },
  {
    value: 'webdav',
    label: 'WebDAV',
    layer: 'mounted',
    description: 'Mounted or aggregated storage entry (recommended with alist/openlist).',
  },
  {
    value: 'github',
    label: 'GitHub',
    layer: 'direct',
    description: 'Release assets or Contents API upload.',
  },
];

export const STORAGE_TYPE_LABELS = STORAGE_TYPES.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

export const STORAGE_FIELDS = {
  telegram: [
    { key: 'botToken', label: 'Bot Token', required: true, secret: true, placeholder: '123456:ABC...' },
    { key: 'chatId', label: 'Chat ID', required: true, placeholder: '-100xxxx' },
    { key: 'apiBase', label: 'API Base', placeholder: 'https://api.telegram.org' },
  ],
  r2: [
    {
      key: 'adapterMode', label: 'Adapter Mode', input: 'select', required: true,
      options: [
        { value: 'binding', label: 'Native Binding' },
        { value: 's3', label: 'S3 Credentials' },
      ],
    },
    {
      key: 'bindingName', label: 'Binding Name', required: true,
      placeholder: 'R2_BUCKET', when: { adapterMode: 'binding' },
    },
    {
      key: 'endpoint', label: 'Endpoint', required: true,
      placeholder: 'https://xxxx.r2.cloudflarestorage.com', when: { adapterMode: 's3' },
    },
    { key: 'region', label: 'Region', placeholder: 'auto', when: { adapterMode: 's3' } },
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'bucket-name', when: { adapterMode: 's3' } },
    {
      key: 'accessKeyId', label: 'Access Key ID', required: true, secret: true,
      placeholder: 'AKIA...', when: { adapterMode: 's3' },
    },
    {
      key: 'secretAccessKey', label: 'Secret Access Key', required: true, secret: true,
      placeholder: '******', when: { adapterMode: 's3' },
    },
  ],
  s3: [
    { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'https://s3.example.com' },
    { key: 'region', label: 'Region', required: true, placeholder: 'us-east-1' },
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'bucket-name' },
    { key: 'accessKeyId', label: 'Access Key ID', required: true, secret: true, placeholder: 'AKIA...' },
    { key: 'secretAccessKey', label: 'Secret Access Key', required: true, secret: true, placeholder: '******' },
  ],
  discord: [
    { key: 'webhookUrl', label: 'Webhook URL', secret: true, placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'botToken', label: 'Bot Token', secret: true, placeholder: 'Bot token' },
    { key: 'channelId', label: 'Channel ID', placeholder: 'channel id' },
  ],
  huggingface: [
    { key: 'token', label: 'Token', required: true, secret: true, placeholder: 'hf_xxx' },
    { key: 'repo', label: 'Dataset Repo', required: true, placeholder: 'username/repo' },
  ],
  webdav: [
    { key: 'baseUrl', label: 'Base URL', required: true, placeholder: 'https://dav.example.com/remote.php/dav/files/user' },
    { key: 'username', label: 'Username', placeholder: 'optional when using bearer token' },
    { key: 'password', label: 'Password', secret: true, placeholder: 'optional when using bearer token' },
    { key: 'bearerToken', label: 'Bearer Token', secret: true, placeholder: 'optional when using username + password' },
    { key: 'rootPath', label: 'Root Path', placeholder: 'optional path prefix, e.g. uploads' },
  ],
  github: [
    { key: 'repo', label: 'Repository', required: true, placeholder: 'owner/repo' },
    { key: 'token', label: 'Token', required: true, secret: true, placeholder: 'github_pat_xxx' },
    {
      key: 'mode',
      label: 'Mode',
      input: 'select',
      required: true,
      options: [
        { value: 'releases', label: 'Releases' },
        { value: 'contents', label: 'Contents API' },
      ],
    },
    { key: 'prefix', label: 'Path/Prefix', placeholder: 'optional, e.g. uploads' },
    { key: 'releaseTag', label: 'Release Tag', placeholder: 'optional, used in releases mode' },
    { key: 'branch', label: 'Branch', placeholder: 'optional, used in contents mode' },
    { key: 'apiBase', label: 'API Base', placeholder: 'https://api.github.com' },
  ],
};

export const STORAGE_NOTES = {
  telegram: 'Cloudflare Pages web upload is capped at 20MB. For larger Telegram files, send them in Telegram and use the webhook return link.',
  discord: 'Default conservative upload cap in adapter is 25MB.',
  huggingface: 'Regular commit upload path is best for small files (adapter cap 35MB).',
  webdav: 'Supports PUT/GET/DELETE and auto MKCOL for nested paths.',
  github: 'Releases mode is preferred for binaries. Contents mode is better for small files/text and has tighter API limits.',
};

export const DEFAULT_DIRECT_UPLOAD_THRESHOLD = capabilityModule.DIRECT_THRESHOLD_BYTES;
export const DEFAULT_CHUNK_UPLOAD_LIMIT = capabilityModule.DEFAULT_MAX_BYTES;

export const FALLBACK_UPLOAD_LIMITS = Object.freeze(Object.fromEntries(
  STORAGE_TYPES.map(({ value }) => {
    const capability = resolveCapability({ runtime: 'cloudflare', type: value });
    const supportsChunkUpload = capability.modes.includes('multipart');
    return [value, Object.freeze({
      maxBytes: capability.maxBytes,
      directThreshold: supportsChunkUpload ? capability.directThreshold : capability.maxBytes,
      supportsChunkUpload,
    })];
  }),
));

export const STORAGE_GROUPS = [
  {
    value: 'direct',
    label: 'Direct Upload Backends',
    description: 'These backends are uploaded directly by Seraph\'s Pictures.',
  },
  {
    value: 'mounted',
    label: 'Mounted / Aggregation Backends',
    description: 'Recommended for WebDAV mount points such as alist/openlist.',
  },
];

export function getStorageFields(type) {
  return STORAGE_FIELDS[type] || [];
}

export function getStorageLabel(type) {
  return STORAGE_TYPE_LABELS[type] || String(type || '');
}

export function storageEnabledFromStatus(status, type) {
  if (!status || !type) return false;
  const item = status[type];
  if (!item) return false;
  return Boolean((item.connected || item.configured) && item.enabled !== false);
}

export function getUploadLimit(status, type) {
  if (!FALLBACK_UPLOAD_LIMITS[type]) throw new Error('STORAGE_BACKEND_UNSUPPORTED');
  return {
    ...FALLBACK_UPLOAD_LIMITS[type],
    ...(status?.uploadLimits?.[type] || {}),
  };
}
