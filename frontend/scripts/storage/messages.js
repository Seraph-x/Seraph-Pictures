{
  'use strict';

  const storageMessages = Object.freeze({
    zh: Object.freeze({
      'storage.title': '存储设置', 'storage.home': '首页', 'storage.admin': '管理后台',
      'storage.toggleTheme': '切换主题',
      'storage.intro': '管理同类型的多个存储实例。密钥字段始终以掩码显示，留空或保持掩码不会覆盖现有密钥。',
      'storage.loading': '正在加载配置…', 'storage.guestNote': '访客通道独立于管理员存储实例',
      'storage.reload': '重新加载', 'storage.saveGuest': '保存访客通道',
      'storage.instanceName': '实例名称', 'storage.noInstances': '暂无实例',
      'storage.add': '添加', 'storage.edit': '编辑', 'storage.enable': '启用',
      'storage.disable': '禁用', 'storage.setDefault': '设为默认', 'storage.delete': '删除',
      'storage.test': '测试', 'storage.save': '保存', 'storage.cancel': '取消',
      'storage.guestChannel': '访客通道', 'storage.connected': '连接成功',
      'storage.failed': '连接失败', 'storage.default': '默认',
      'storage.enabled': '已启用', 'storage.disabled': '已禁用',
      'storage.confirmDelete': '确认删除 ',
    }),
    en: Object.freeze({
      'storage.title': 'Storage Settings', 'storage.home': 'Home', 'storage.admin': 'Admin',
      'storage.toggleTheme': 'Toggle theme',
      'storage.intro': 'Manage multiple storage instances of the same type. Secrets stay masked; blank or masked values preserve the stored secret.',
      'storage.loading': 'Loading configuration…', 'storage.guestNote': 'Guest Channel is isolated from administrator profiles',
      'storage.reload': 'Reload', 'storage.saveGuest': 'Save Guest Channel',
      'storage.instanceName': 'Instance Name', 'storage.noInstances': 'No instances',
      'storage.add': 'Add', 'storage.edit': 'Edit', 'storage.enable': 'Enable',
      'storage.disable': 'Disable', 'storage.setDefault': 'Set Default', 'storage.delete': 'Delete',
      'storage.test': 'Test', 'storage.save': 'Save', 'storage.cancel': 'Cancel',
      'storage.guestChannel': 'Guest Channel', 'storage.connected': 'Connected',
      'storage.failed': 'Connection failed', 'storage.default': 'default',
      'storage.enabled': 'enabled', 'storage.disabled': 'disabled',
      'storage.confirmDelete': 'Delete ',
    }),
  });

  if (globalThis.I18n) globalThis.I18n.register(storageMessages);

  function storageText(key) {
    return globalThis.I18n ? globalThis.I18n.t(key) : storageMessages.zh[key] || key;
  }

  function storageOnLanguageChange(callback) {
    return globalThis.I18n ? globalThis.I18n.onChange(callback) : () => {};
  }

  const legacyStorageMessages = Object.freeze({ text: storageText, onChange: storageOnLanguageChange });
  if (typeof module === 'object' && module.exports) module.exports = legacyStorageMessages;
  globalThis.LegacyStorageMessages = legacyStorageMessages;
}
