if (window.I18n) {
  I18n.register({
zh: {
'admin.loadedSearchScope': '搜索、筛选和排序作用于已加载的 {n} 个文件，可在底部继续加载。',
'admin.guestDailyLimitUnit': '次/天（0 表示不限）',
'admin.guestMaxFileSizeTitle': '单文件大小上限',
'admin.guestMaxFileSizeUnit': 'MB（上限 20，即 Telegram 原生限制；0 表示不额外限制）',
'admin.guestSaveSettings': '保存设置',
'admin.guestSaving': '保存中...',
'admin.guestSaved': '✓ 已保存',
'admin.guestVerifyFailed': '保存后回读校验失败，请检查 KV 绑定与 Functions 日志。',
'admin.guestSavedSyncedBinding': '已保存并同步到服务端{binding}。',
'admin.guestSavedMsg': '访客上传设置已保存{binding}',
'admin.guestNeedLogin': '需要管理员登录后才能保存。',
'admin.guestSaveFailed': '保存失败：{msg}',
'admin.guestReadConfigFailed': '读取访客上传配置失败：{msg}',
'admin.thumbnailPaused': '缩略图已暂停加载',
'admin.safePreviewHidden': '安全模式已隐藏预览',
'admin.syncDataError': '同步数据时出错，请检查网络连接',
'admin.refreshListFailed': '刷新文件列表失败，请检查网络连接',
'admin.loadMoreSupplementN': '已补充 {n} 条数据，可继续翻页',
'admin.loadMoreRestN': '已加载剩余 {n} 条',
'admin.loadMoreFailed': '加载更多失败，请稍后重试'
},
en: {
'admin.loadedSearchScope': 'Search, filters and sorting apply to the {n} loaded files. Load more below.',
'admin.guestDailyLimitUnit': 'per day (0 means unlimited)',
'admin.guestMaxFileSizeTitle': 'Max file size',
'admin.guestMaxFileSizeUnit': 'MB (max 20, the Telegram native limit; 0 means no extra limit)',
'admin.guestSaveSettings': 'Save',
'admin.guestSaving': 'Saving...',
'admin.guestSaved': '✓ Saved',
'admin.guestVerifyFailed': 'Read-back verification failed after saving. Check the KV binding and Functions logs.',
'admin.guestSavedSyncedBinding': 'Saved and synced to server{binding}.',
'admin.guestSavedMsg': 'Guest upload settings saved{binding}',
'admin.guestNeedLogin': 'Admin login is required to save.',
'admin.guestSaveFailed': 'Save failed: {msg}',
'admin.guestReadConfigFailed': 'Failed to read guest upload config: {msg}',
'admin.thumbnailPaused': 'Thumbnail loading paused',
'admin.safePreviewHidden': 'Preview hidden by safe mode',
'admin.syncDataError': 'Error syncing data, please check your connection',
'admin.refreshListFailed': 'Failed to refresh file list, please check your connection',
'admin.loadMoreSupplementN': 'Added {n} more records, you can keep paging',
'admin.loadMoreRestN': 'Loaded remaining {n} records',
'admin.loadMoreFailed': 'Failed to load more, please try again later'
}
  });
}
