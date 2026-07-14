# Multi-Storage Migration Rehearsal / 多存储迁移演练

日期：2026-07-14

范围：`storage_profiles:v1`、Legacy 配置、Cloudflare 类型级文件引用、Docker SQLite Profile/文件引用，以及 v2 generation/ledger 激活。

## 结论

一次性 JSON + SQLite 状态上的 dry-run、首次 apply 和重复 apply 均完成。两次 apply 得到同一 generation，Cloudflare 与 Docker 的 Profile/引用数量未增加；Guest Channel 未进入 Profile Catalog。显式 activation 拒绝会释放锁，激活后验证失败会回滚到捕获的旧指针，激活结果不明确则保留锁等待 reconciliation。

## Fixture 矩阵

| Fixture | 验证内容 |
| --- | --- |
| `combined-source.json` | v1 catalog、既有 Docker 行、Legacy R2、精确 ID 与 type-only 文件混合 |
| `legacy-only-source.json` | 没有 Profile 时生成确定性 Legacy ID；排除 `telegramGuest` |
| `disabled-only-source.json` | 某类型全部禁用时以 `STORAGE_MIGRATION_FAILED` 失败 |
| `active-uploads.json` | freeze 显示活动上传时不 stage，并显式释放已取得的锁 |
| `activation-failure.json` | 激活明确拒绝时不伪造成功、不执行无依据 rollback |
| `rollback-pointer.json` | 激活后验证失败使用迁移前 generation 指针回滚 |
| `cloudflare-state.json` + `rehearsal-driver.mjs` | 对一次性 JSON/SQLite 状态执行备份、stage、activate、marker 与重复执行 |

这些文件位于 `test/fixtures/storage-migration/`。`rehearsal-driver.mjs` 只用于一次性演练，不是生产 Cloudflare/SQLite 连接器。

## 可重放命令

```bash
ROOT="$(mktemp -d /tmp/seraph-storage-migration.XXXXXX)"
cp test/fixtures/storage-migration/cloudflare-state.json "$ROOT/cloudflare-state.json"

node scripts/security/migrate-storage-profiles.mjs \
  --input test/fixtures/storage-migration/combined-source.json \
  > "$ROOT/dry-run.json"

STORAGE_MIGRATION_REHEARSAL_CF_STATE="$ROOT/cloudflare-state.json" \
STORAGE_MIGRATION_REHEARSAL_DOCKER_STATE="$ROOT/docker.sqlite" \
node scripts/security/migrate-storage-profiles.mjs \
  --input test/fixtures/storage-migration/combined-source.json \
  --apply \
  --driver test/fixtures/storage-migration/rehearsal-driver.mjs \
  --token rehearsal-token \
  --cloudflare-backup "$ROOT/first-cloudflare.json" \
  --docker-backup "$ROOT/first-docker.sqlite" \
  > "$ROOT/first-apply.json"

shasum -a 256 \
  test/fixtures/storage-migration/combined-source.json \
  "$ROOT/dry-run.json" \
  "$ROOT/first-cloudflare.json" \
  "$ROOT/first-docker.sqlite"
```

重复 apply 时使用新的备份文件名，但复用同一 `cloudflare-state.json` 与 `docker.sqlite`。自动化重放：

```bash
npm test -- --grep "storage profile migration|storage profile persisted rehearsal"
```

## 2026-07-14 证据

演练目录：`/tmp/seraph-storage-migration.jNx68t`（一次性，不纳入仓库）。

| Artifact | SHA-256 |
| --- | --- |
| `combined-source.json` | `be7f612817796a4fe39fce85950a52dc951b286a5d7ced266cadef59080ac175` |
| `dry-run.json` | `73dc92f68be1c01841bceed13e26cae1fbcc5b27ed8a8671aabc8e746a80fb1a` |
| 首次 Cloudflare backup | `af2f6325b7f5c64c35f6c31927d79b238ecfc4e9267b557e01e028de565eae55` |
| 首次 Docker backup | `e4790027b3f645d7344eb3170d5358d4cfd5b642168d2edf74334bca6a49d60b` |
| 重复执行前 Cloudflare backup | `293dc199f29a6b8c92d71bf3a1fac37146d9caaeab3ea9e2f4b7453abed67f38` |
| 重复执行前 Docker backup | `97bf6679910905b557c41ff4a1a7a289e6a86f2c3cd649c37a5e4bfb82fd5dc7` |

- generation：两次均为 `generation-5070c4fc70f334cb`。
- preferred type：`telegram`。
- Cloudflare：3 Profiles、3 References；默认映射为 `telegram -> cf-primary`、`r2 -> sc_legacy_cd4dbd1e947f35fa`。
- Cloudflare 引用：`cf-primary=1`、`cf-archive=1`、`sc_legacy_cd4dbd1e947f35fa=1`。
- Docker：1 Profile、2 References；默认映射为 `webdav -> docker-webdav`，引用数 `docker-webdav=2`。
- v2 marker：两个 runtime 均为 `generation-5070c4fc70f334cb`。
- rollback pointer：重复执行后仍为 `generation-v1`；未被同 generation 重试覆盖。

## 生产迁移流程

1. 从实时系统导出 v1 catalog、Legacy 配置、文件元数据、Coordinator authority/ledger 与 Docker SQLite，记录每份输入和备份的 SHA-256。
2. 先运行不带 `--apply` 的 dry-run。逐类型确认 enabled default、Profile ID、`legacyTypeProfileIds` 和引用计数；Guest Channel 不应出现。
3. 为目标环境提供显式 driver。它必须实现真实 backup、freeze/lock、stage、activate、live verify、marker 和 rollback；CLI 不提供全局凭据 fallback。
4. apply 必须提供独立 Cloudflare/Docker 备份路径和不可复用到其他迁移的 owner token。活动上传未清零时停止，不得绕过。
5. 激活后对 exact `storageConfigId`、generation-scoped type-only 映射、禁用 Profile 历史读取、每 Profile 状态和既有链接执行 live verify。
6. marker 与 live verify 完成后才解冻。重复执行只验证相同 generation 和计数，不创建重复 Profile。

生产命令形状：

```bash
node scripts/security/migrate-storage-profiles.mjs --input <SOURCE_SNAPSHOT.json>

node scripts/security/migrate-storage-profiles.mjs \
  --input <SOURCE_SNAPSHOT.json> --apply \
  --driver <ENVIRONMENT_DRIVER.mjs> \
  --owner storage-profile-migration --token <ONE_TIME_OWNER_TOKEN> \
  --cloudflare-backup <CLOUDFLARE_BACKUP.json> \
  --docker-backup <DOCKER_BACKUP.sqlite>
```

## 回滚与错误

| 结果/错误 | 操作 |
| --- | --- |
| `STORAGE_MIGRATION_FAILED`（激活前或明确拒绝） | 保持旧 authority，检查 stage/计数，确认 freeze/lock 已显式释放后修复再运行 |
| 激活后 live verify 失败 | executor 用捕获的旧 generation 回滚；验证旧指针可读并核对备份后再解冻 |
| `MIGRATION_ACTIVATION_AMBIGUOUS` | 不解冻、不释放 Docker lock；读取 authority、catalog 与 ledger 取得明确证据后 reconciliation |
| `ACTIVE_MUTATIONS_REMAIN` | 等待或终止活动上传，确认引用/临时任务状态后重新取得 freeze；不得强制跳过 |
| `MIGRATION_RECOVERY_FAILED` | 同时保留原始错误与清理错误，按备份、authority、freeze owner 和 Docker lock 逐项恢复 |

## English summary

The disposable rehearsal migrated a v1 Cloudflare catalog, existing Docker rows, legacy-only configurations, and mixed exact/type-only file references. Both apply runs converged on `generation-5070c4fc70f334cb` with 3/3 Cloudflare profiles/references and 1/2 Docker profiles/references. The rollback pointer remained `generation-v1`. Guest Channel data was excluded. Production operators must supply an environment-specific driver, verify backups and counts before activation, and keep locks held whenever activation outcome is ambiguous.
