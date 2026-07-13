class GuestStorageRepository {
  constructor(options) {
    this.storageRepo = options.storageRepo;
    this.bootstrap = options.bootstrap || {};
  }

  resolveGuestStorage() {
    return this.storageRepo.list(true).find((item) => (
      item.enabled && item.metadata?.guestUpload === true
    )) || null;
  }

  ensureBootstrap() {
    if (this.resolveGuestStorage()) return;
    const { botToken, chatId, apiBase } = this.bootstrap;
    if (!botToken || !chatId) return;
    this.storageRepo.create({
      name: 'Telegram Guest Uploads (Env Bootstrap)',
      type: 'telegram',
      config: { botToken, chatId, apiBase },
      enabled: true,
      isDefault: false,
      metadata: { source: 'env-bootstrap', guestUpload: true },
    });
  }
}

module.exports = { GuestStorageRepository };
