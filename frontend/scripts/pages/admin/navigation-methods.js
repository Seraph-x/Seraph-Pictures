{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({
    mounted() {
      // Element UI 2 assigns aria-haspopup="list" after mounting its trigger.
      Object.keys(this.$refs).filter((name) => name.startsWith('navMenu'))
        .forEach((name) => this.setNavigationMenuExpanded(name, false));
    },
    methods: {
      setNavigationMenuExpanded(name, expanded) {
        const trigger = this.$refs[name];
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', String(expanded));
      },
    },
  });
}
