{
  'use strict';
  const ADMIN_INITIAL_STATE = {
      lang: (window.I18n && I18n.getLang()) || 'zh',
      baseURL: document.location.origin,
      Number: 0,
      totalCount: 0,
      fileConfig: {
        all: {
          name: (window.I18n ? I18n.t('admin.typeAll') : '全部'),
          exts: [],  // 空数组表示匹配所有
          icon: 'fas fa-th-large',
          count: 0
        },
        image: {
          name: (window.I18n ? I18n.t('admin.typeImage') : '图片'),
          exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg', 'heic', 'heif', 'avif'],
          icon: 'fas fa-image',
          count: 0
        },
        video: {
          name: (window.I18n ? I18n.t('admin.typeVideo') : '视频'),
          exts: ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', 'ts'],
          icon: 'fas fa-video',
          count: 0
        },
        audio: {
          name: (window.I18n ? I18n.t('admin.typeAudio') : '音频'),
          exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'ape', 'opus'],
          icon: 'fas fa-music',
          count: 0
        },
        document: {
          name: (window.I18n ? I18n.t('admin.typeDocument') : '文件'),
          exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'zip', 'rar', '7z', 'tar', 'gz', 'exe', 'apk', 'dmg', 'iso', 'msi', 'deb', 'rpm', 'json', 'xml', 'csv', 'sql', 'html', 'css', 'js', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'h'],
          icon: 'fas fa-folder-open',
          count: 0
        }
      },
      uploadConfig: {
        maxSize: 20 * 1024 * 1024,  // 最大上传20MB
        maxConcurrent: 3
      },
        tableData: [],
        nextCursor: null,
      isLoadingMore: false,
      search: '',
      currentPage: 1,
      pageSize: 24,
      selectedFiles: [],
      sortOption: 'dateDesc',
      filterOption: 'all',
      fileType: 'all',
      storageFilter: 'all', // all | telegram | r2
      viewMode: 'grid', // grid | list
      folders: [],
      folderPath: '',
      folderLoading: false,
      folderMutating: false,
      folderMutatingAction: '',
      listRequestSeq: 0,
      isMobileViewport: false,
      mobileNavMetricsRaf: 0,
      headerResizeObserver: null,
      folderListCache: {},
      folderCacheTTL: 3 * 60 * 1000,
      folderCacheMaxEntries: 12,
      dragState: {
        active: false,
        fileIds: [],
        targetPath: null,
        leaveTimer: null,
        rafId: null,
      },
      loadMode: 'normal', // normal | dataSaver | noImage
      safeMode: true, // NSFW 安全模式
      systemStatus: {
        telegram: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...') },
        kv: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...') },
        r2: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        s3: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        discord: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        huggingface: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        webdav: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        github: { connected: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...'), enabled: false },
        auth: { enabled: false, message: (window.I18n ? I18n.t('admin.statusChecking') : '检查中...') }
      },
      batchToolbarPosition: {
        left: null,
        top: null
      },
      batchDragState: {
        dragging: false,
        offsetX: 0,
        offsetY: 0
      },
      previewData: null,  // 模态框预览数据
      isFullscreen: false,  // 预览是否处于全屏
      tokenDialogVisible: false,
      tokenLoading: false,
      createTokenDialogVisible: false,
      tokenCreateLoading: false,
      createdTokenDialogVisible: false,
      createdTokenValue: '',
      createdTokenCopied: false,
      apiTokens: [],
      tokenMutatingMap: {},
      tokenForm: {
        name: '',
        scopes: ['upload', 'read'],
        expiryPreset: 'never',
        customExpiresAt: '',
      },
      };
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({
data() {
    return JSON.parse(JSON.stringify(ADMIN_INITIAL_STATE));
  },
computed: {
      filteredTableData() {
        return this.tableData.filter(data => {
          // 搜索匹配
          const searchLower = this.search.toLowerCase();
          const matchesSearch = !searchLower || [
            (data.metadata.fileName || '').toLowerCase(),
            data.name?.toLowerCase(),
          ].some(field => field?.includes(searchLower));

          // 筛选匹配
          const matchesFilter = {
            'all': true,
            'favorites': data.metadata.liked,
            'blocked': data.metadata.ListType === 'Block',
            'unblocked': data.metadata.ListType === 'White',
            'adult': data.metadata.Label?.toLowerCase() === 'adult',
          }[this.filterOption] ?? true;

          // 文件类型匹配
          const ext = data.name.split('.').pop().toLowerCase();
          let matchesType = true;

          if (this.fileType === 'all') {
            // 全部模式：显示所有文件
            matchesType = true;
          } else if (this.fileType === 'document') {
            // 文档模式：排除图片、视频、音频
            matchesType = !Object.keys(this.fileConfig).some(type =>
              type !== 'document' && type !== 'all' && this.fileConfig[type].exts.includes(ext)
            );
          } else {
            // 特定类型模式
            matchesType = this.fileConfig[this.fileType].exts.includes(ext);
          }

          // 存储类型匹配
          const storagePrefix = this.getStorageType(data.name);
          const matchesStorage = this.storageFilter === 'all' || this.storageFilter === storagePrefix;
          // 目录筛选由后端 list 接口按 folderPath 负责，前端此处不再重复过滤，
          // 避免“全部文件”分页出现空白页。
          const matchesFolder = true;

          return matchesSearch && matchesFilter && matchesType && matchesStorage && matchesFolder;
        });
      },
      paginatedTableData() {
        return this.sortData(this.filteredTableData)
          .slice((this.currentPage - 1) * this.pageSize, this.currentPage * this.pageSize);
      },
      paginationTotal() {
        return this.filteredTableData.length;
      },
      paginatedData() {
        return this.paginatedTableData;
      },
      isAllSelected() {
        return this.paginatedData.length > 0 && this.paginatedData.every(f => f.selected);
      },
      sortIcon() {
        return this.sortOption === 'dateDesc' ? 'fas fa-sort-numeric-down' :
               this.sortOption === 'nameAsc' ? 'fas fa-sort-alpha-up' :
               this.sortOption === 'sizeDesc' ? 'fas fa-sort-amount-down' : 'fas fa-sort';
      },
      filterIcon() {
        return this.filterOption === 'all' ? 'fas fa-filter' :
        this.filterOption === 'favorites' ? 'fas fa-bookmark' :
        this.filterOption === 'blocked' ? 'fas fa-lock' :
        this.filterOption === 'unblocked' ? 'fas fa-unlock' :
        this.filterOption === 'adult' ? 'fas fa-user-secret' : '';
      },
      fileTypeIcon() {
        return this.fileType === 'all' ? 'fas fa-th-large' :
        this.fileType === 'image' ? 'fas fa-image' :
        this.fileType === 'video' ? 'fas fa-video' :
        this.fileType === 'audio' ? 'fas fa-music' :
        this.fileType === 'document' ? 'fas fa-folder-open' : 'fas fa-th-large';
      },
      storageFilterIcon() {
        return this.storageFilter === 'all' ? 'fas fa-boxes' :
        this.storageFilter === 'telegram' ? 'fab fa-telegram' :
        this.storageFilter === 'r2' ? 'fas fa-cloud' :
        this.storageFilter === 's3' ? 'fas fa-database' :
        this.storageFilter === 'discord' ? 'fab fa-discord' :
        this.storageFilter === 'huggingface' ? 'fas fa-robot' :
        this.storageFilter === 'webdav' ? 'fas fa-hard-drive' :
        this.storageFilter === 'github' ? 'fab fa-github' : 'fas fa-boxes';
      },
      viewModeIcon() {
        return this.viewMode === 'list' ? 'fas fa-list' : 'fas fa-th';
      },
      folderBreadcrumbs() {
        const parts = this.normalizeFolderPath(this.folderPath).split('/').filter(Boolean);
        const result = [];
        for (let i = 0; i < parts.length; i += 1) {
          result.push({
            name: parts[i],
            path: parts.slice(0, i + 1).join('/'),
          });
        }
        return result;
      },
      folderTreeNodes() {
        const list = [{
          path: '',
          name: this.t('admin.allFiles'),
          depth: 0,
          fileCount: this.folderPath ? '-' : this.Number,
        }];
        const nodes = (this.folders || []).map((folder) => {
          const path = this.normalizeFolderPath(folder.path || folder.folderPath || '');
          const depth = Number.isFinite(folder.depth) ? folder.depth : (path ? path.split('/').length : 0);
          return {
            path,
            name: folder.name || (path.split('/').pop() || path || this.t('admin.unnamedFolder')),
            depth,
            fileCount: Number(folder.fileCount || 0),
          };
        }).sort((a, b) => {
          if (a.depth !== b.depth) return a.depth - b.depth;
          return a.path.localeCompare(b.path, 'zh-CN');
        });
        return list.concat(nodes);
      },
      batchToolbarStyle() {
        if (this.isMobileViewport) {
          return {};
        }
        if (this.batchToolbarPosition.left === null || this.batchToolbarPosition.top === null) {
          return {};
        }
        return {
          left: `${this.batchToolbarPosition.left}px`,
          top: `${this.batchToolbarPosition.top}px`,
          bottom: 'auto',
          transform: 'translate(0, 0)'
        };
      }
    },
watch: {  // 监听数据变化
      tableData: {
        handler(newData) {
          this.selectedFiles = newData.filter(file => file.selected);
        },
        deep: true
      },
      search() {
        this.currentPage = 1;
        this.normalizeCurrentPage();
      },
      selectedFiles(newValue) {
        if (newValue.length === 0) {
          this.batchToolbarPosition.left = null;
          this.batchToolbarPosition.top = null;
          return;
        }
        if (this.isMobileViewport) {
          this.batchToolbarPosition.left = null;
          this.batchToolbarPosition.top = null;
          return;
        }
        if (this.batchToolbarPosition.left === null) {
          this.$nextTick(() => this.snapBatchToolbarToBottom());
        }
      },
      sortOption(newOption) { localStorage.setItem('sortOption', newOption); },
      filterOption(newOption) {
        localStorage.setItem('filterOption', newOption);
        this.currentPage = 1;
        this.normalizeCurrentPage();
      },
      paginationTotal() {
        this.normalizeCurrentPage();
      },
      viewMode(newValue) { localStorage.setItem('adminViewMode', newValue); },
      folderPath(newValue) { localStorage.setItem('adminFolderPath', this.normalizeFolderPath(newValue)); }
    }
  });
}
