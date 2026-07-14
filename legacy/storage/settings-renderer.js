{
  'use strict';

  const LEGACY_STORAGE_TYPES = Object.freeze([
    { type: 'telegram', label: 'Telegram', fields: [
      ['botToken', 'Bot Token', 'secret'], ['chatId', 'Chat ID'], ['apiBase', 'API Base'],
    ] },
    { type: 'r2', label: 'R2', fields: [
      ['adapterMode', 'Adapter Mode', 'select', [['binding', 'Native Binding'], ['s3', 'S3 Credentials']]],
      ['bindingName', 'Binding Name', '', null, ['adapterMode', 'binding']],
      ['endpoint', 'Endpoint', '', null, ['adapterMode', 's3']],
      ['region', 'Region', '', null, ['adapterMode', 's3']],
      ['bucket', 'Bucket', '', null, ['adapterMode', 's3']],
      ['accessKeyId', 'Access Key ID', 'secret', null, ['adapterMode', 's3']],
      ['secretAccessKey', 'Secret Access Key', 'secret', null, ['adapterMode', 's3']],
    ] },
    { type: 's3', label: 'S3', fields: [
      ['endpoint', 'Endpoint'], ['region', 'Region'], ['bucket', 'Bucket'],
      ['accessKeyId', 'Access Key ID', 'secret'], ['secretAccessKey', 'Secret Access Key', 'secret'],
    ] },
    { type: 'discord', label: 'Discord', fields: [
      ['webhookUrl', 'Webhook URL', 'secret'], ['botToken', 'Bot Token', 'secret'], ['channelId', 'Channel ID'],
    ] },
    { type: 'huggingface', label: 'HuggingFace', fields: [
      ['token', 'Token', 'secret'], ['repo', 'Dataset Repo'],
    ] },
    { type: 'webdav', label: 'WebDAV', fields: [
      ['baseUrl', 'Base URL'], ['username', 'Username'], ['password', 'Password', 'secret'],
      ['bearerToken', 'Bearer Token', 'secret'], ['rootPath', 'Root Path'],
    ] },
    { type: 'github', label: 'GitHub', fields: [
      ['repo', 'Repository'], ['token', 'Token', 'secret'],
      ['mode', 'Mode', 'select', [['releases', 'Releases'], ['contents', 'Contents API']]],
      ['prefix', 'Path/Prefix'], ['releaseTag', 'Release Tag'], ['branch', 'Branch'], ['apiBase', 'API Base'],
    ] },
  ]);
  const LEGACY_STORAGE_ACTIONS = Object.freeze(['add', 'edit', 'toggle', 'default', 'delete', 'test']);
  const STORAGE_MASKED_SECRET = '********';
  const storageText = globalThis.LegacyStorageMessages?.text || ((key) => key);

  function storageElement(documentRef, tag, options = {}) {
    const node = documentRef.createElement(tag);
    const children = options.children || [];
    for (const [key, value] of Object.entries(options)) {
      if (key === 'children') continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  function storageTypeDefinition(type) {
    return LEGACY_STORAGE_TYPES.find((item) => item.type === type);
  }

  function storageFieldDefinition(tuple) {
    return Object.freeze({
      key: tuple[0], label: tuple[1], secret: tuple[2] === 'secret',
      input: tuple[2] === 'select' ? 'select' : 'input',
      options: tuple[3] || [], when: tuple[4] || null,
    });
  }

  function storageFieldVisible(field, config) {
    return !field.when || config[field.when[0]] === field.when[1];
  }

  function storageCreateInput(context) {
    const { documentRef, field, config, editing, type } = context;
    let input;
    if (field.input === 'select') {
      input = storageElement(documentRef, 'select');
      for (const option of field.options) {
        const node = storageElement(documentRef, 'option', { value: option[0], text: option[1] });
        if (config[field.key] === option[0]) node.selected = true;
        input.appendChild(node);
      }
      input.disabled = !editing;
    } else {
      input = storageElement(documentRef, 'input');
      input.type = field.secret ? 'password' : 'text';
      input.value = config[field.key] || '';
      input.readOnly = !editing;
      if (field.secret) input.autocomplete = 'new-password';
    }
    input.dataset.configKey = field.key;
    input.dataset.type = type;
    return input;
  }

  function storageCreateField(context) {
    const input = storageCreateInput(context);
    const label = storageElement(context.documentRef, 'label', { text: context.field.label });
    return storageElement(context.documentRef, 'div', { class: 'field', children: [label, input] });
  }

  function storageCreateSelector(documentRef, card) {
    const select = storageElement(documentRef, 'select', {
      'data-storage-profile-select': '1', 'data-type': card.type,
    });
    for (const item of card.options) {
      const statuses = [];
      if (item.isDefault) statuses.push(storageText('storage.default'));
      statuses.push(storageText(item.enabled ? 'storage.enabled' : 'storage.disabled'));
      const label = `${item.name} · ${statuses.join(' · ')}`;
      const option = storageElement(documentRef, 'option', { value: item.id, text: label });
      if (card.selected?.id === item.id) option.selected = true;
      select.appendChild(option);
    }
    if (!card.options.length) select.appendChild(storageElement(documentRef, 'option', {
      text: storageText('storage.noInstances'),
    }));
    select.disabled = !card.options.length || card.mode !== 'view';
    return select;
  }

  function storageActionButton(documentRef, action, card) {
    const profile = card.selected;
    const labels = {
      add: storageText('storage.add'), edit: storageText('storage.edit'),
      toggle: storageText(profile?.enabled ? 'storage.disable' : 'storage.enable'),
      default: storageText('storage.setDefault'), delete: storageText('storage.delete'),
      test: storageText('storage.test'),
    };
    const button = storageElement(documentRef, 'button', {
      type: 'button', class: action === 'delete' ? 'btn-ghost danger' : 'btn-ghost',
      'data-action': action, 'data-type': card.type, 'data-id': profile?.id || '', text: labels[action],
    });
    if (action !== 'add' && !profile) button.disabled = true;
    if (['toggle', 'delete'].includes(action) && profile?.isDefault) button.disabled = true;
    if (action === 'default' && (profile?.isDefault || !profile?.enabled)) button.disabled = true;
    return button;
  }

  function storageProfileHeader(documentRef, card, definition) {
    const title = storageElement(documentRef, 'h2', { children: [
      storageElement(documentRef, 'i', { class: 'fas fa-database' }),
      storageElement(documentRef, 'span', { text: definition.label }),
    ] });
    const selector = storageCreateSelector(documentRef, card);
    return storageElement(documentRef, 'div', {
      class: 'card-header profile-card-header',
      children: [storageElement(documentRef, 'div', { children: [title] }), selector],
    });
  }

  function storageProfileFields(documentRef, card, definition) {
    const editing = card.mode !== 'view';
    const source = editing ? card.draft : card.selected;
    const config = source?.config || {};
    const grid = storageElement(documentRef, 'div', { class: 'field-grid' });
    const nameField = storageFieldDefinition(['name', storageText('storage.instanceName')]);
    const nameConfig = { name: source?.name || '' };
    grid.appendChild(storageCreateField({ documentRef, field: nameField, config: nameConfig, editing, type: card.type }));
    for (const tuple of definition.fields) {
      const field = storageFieldDefinition(tuple);
      if (!editing && !storageFieldVisible(field, config)) continue;
      grid.appendChild(storageCreateField({ documentRef, field, config, editing, type: card.type }));
    }
    return grid;
  }

  function storageProfileActions(documentRef, card, error) {
    const actionbar = storageElement(documentRef, 'div', { class: 'profile-actions' });
    if (card.mode === 'view') {
      for (const action of LEGACY_STORAGE_ACTIONS) {
        actionbar.appendChild(storageActionButton(documentRef, action, card));
      }
    } else {
      actionbar.appendChild(storageElement(documentRef, 'button', {
        type: 'button', class: 'btn-primary', 'data-action': 'save', 'data-type': card.type,
        text: storageText('storage.save'),
      }));
      actionbar.appendChild(storageElement(documentRef, 'button', {
        type: 'button', class: 'btn-ghost', 'data-action': 'cancel', 'data-type': card.type,
        text: storageText('storage.cancel'),
      }));
    }
    if (error) actionbar.appendChild(storageElement(documentRef, 'span', {
      class: 'status-line err', 'data-profile-error': card.type, text: error,
    }));
    if (card.result) actionbar.appendChild(storageElement(documentRef, 'span', {
      class: `status-line ${card.result.connected ? 'ok' : 'err'}`,
      text: storageText(card.result.connected ? 'storage.connected' : 'storage.failed'),
    }));
    return actionbar;
  }

  function storageCreateProfileCard(documentRef, card, error) {
    const definition = storageTypeDefinition(card.type);
    const node = storageElement(documentRef, 'section', {
      class: 'card storage-profile-card', 'data-profile-type': card.type,
    });
    node.appendChild(storageProfileHeader(documentRef, card, definition));
    node.appendChild(storageProfileFields(documentRef, card, definition));
    node.appendChild(storageProfileActions(documentRef, card, error));
    return node;
  }

  function storageCreateGuestCard(documentRef, guest) {
    const node = storageElement(documentRef, 'section', { class: 'card guest-block' });
    node.appendChild(storageElement(documentRef, 'div', { class: 'guest-title', children: [
      storageElement(documentRef, 'i', { class: 'fas fa-user-group' }),
      storageElement(documentRef, 'span', { text: storageText('storage.guestChannel') }),
    ] }));
    const grid = storageElement(documentRef, 'div', { class: 'field-grid' });
    const schema = (guest.schema || []).find((item) => item.type === 'telegramGuest');
    for (const item of schema?.fields || []) {
      const field = Object.freeze({ ...item, input: 'input' });
      const config = { ...(guest.config?.telegramGuest || {}) };
      if (field.secret && guest.secretsPresent?.telegramGuest?.[field.key]) {
        config[field.key] = '********';
      }
      grid.appendChild(storageCreateField({ documentRef, field, config, editing: true, type: 'telegramGuest' }));
    }
    node.appendChild(grid);
    return node;
  }

  function storageCollectProfile(cardNode) {
    const config = {};
    let name = '';
    for (const input of cardNode.querySelectorAll('[data-config-key]')) {
      if (input.dataset.configKey === 'name') name = input.value.trim();
      else config[input.dataset.configKey] = input.value;
    }
    return Object.freeze({ name, enabled: true, config: Object.freeze(config) });
  }

  function storageCollectGuest(root) {
    const config = {};
    for (const input of root.querySelectorAll('[data-type="telegramGuest"][data-config-key]')) {
      if (input.type === 'password' && (!input.value || input.value === STORAGE_MASKED_SECRET)) continue;
      config[input.dataset.configKey] = input.value;
    }
    return Object.freeze({ telegramGuest: Object.freeze(config) });
  }

  function storageCreateRenderer(options) {
    const root = options.root;
    const documentRef = options.documentRef || document;
    let handler = null;
    let currentView = null;

    function report(promise) {
      Promise.resolve(promise).catch((error) => console.error('[storage-settings]', error));
    }

    function bind(nextHandler) {
      handler = nextHandler;
      root.addEventListener('change', (event) => {
        const select = event.target.closest('[data-storage-profile-select]');
        if (select) report(handler({ action: 'select', type: select.dataset.type, id: select.value }));
      });
      root.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const detail = { action: button.dataset.action, type: button.dataset.type, id: button.dataset.id };
        if (detail.action === 'save') detail.payload = storageCollectProfile(button.closest('[data-profile-type]'));
        report(handler(detail));
      });
      documentRef.getElementById('saveBtn').addEventListener('click', () => {
        report(handler({ action: 'guest-save', payload: storageCollectGuest(root) }));
      });
      documentRef.getElementById('reloadBtn').addEventListener('click', () => report(handler({ action: 'reload' })));
      globalThis.LegacyStorageMessages?.onChange(() => {
        if (currentView) render(currentView);
      });
    }

    function render(view) {
      currentView = view;
      root.innerHTML = '';
      if (view.globalError) root.appendChild(storageElement(documentRef, 'div', {
        class: 'empty status-line err', text: view.globalError,
      }));
      for (const card of view.cards) root.appendChild(storageCreateProfileCard(documentRef, card, view.errors[card.type]));
      root.appendChild(storageCreateGuestCard(documentRef, view.guest));
      documentRef.getElementById('actionbar').style.display = 'flex';
    }

    return Object.freeze({ bind, render });
  }

  const legacyStorageRenderer = Object.freeze({ createSettingsRenderer: storageCreateRenderer });
  if (typeof module === 'object' && module.exports) module.exports = legacyStorageRenderer;
  if (typeof globalThis === 'object') globalThis.LegacyStorageRenderer = legacyStorageRenderer;
}
