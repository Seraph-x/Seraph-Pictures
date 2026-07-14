{
  'use strict';

  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({
    methods: {
      showUiDesignSettingsPanel: globalThis.LegacyAdminUiDesign.showUiDesignSettingsPanel,
      showAccountSecurityPanel: globalThis.LegacyAdminAccount.showAccountSecurityPanel,
      showGuestSettingsPanel: globalThis.LegacyAdminGuest.showGuestSettingsPanel,
      shouldShowImage(item) {
        if (this.loadMode === 'noImage') return false;
        if (this.loadMode !== 'dataSaver') return true;
        const dataSaverLimit = 5 * 1024 * 1024;
        return (item.metadata?.fileSize || 0) <= dataSaverLimit;
      },
      isNsfwContent(item) {
        return this.safeMode && item.metadata?.Label?.toLowerCase() === 'adult';
      },
    },
  });
}
