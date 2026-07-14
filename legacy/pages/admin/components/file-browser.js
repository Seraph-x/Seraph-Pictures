{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.fileBrowser = `            <template v-if="viewMode === 'grid'">
              <div class="content">
                <template v-for="(item, index) in paginatedTableData" :key="index">
            <!-- 图片 - 根据实际文件类型渲染 -->
            <template v-if="getActualFileType(item.name) === 'image'">
              <el-card class="image-card" :draggable="true" @dragstart="handleFileDragStart(item, $event)" @dragend="handleFileDragEnd">
                <span class="collect-icon" @click.stop="toggleLike(index, item.name)">
                <i :class="item.metadata.liked ? 'fa-solid fa-bookmark liked' : 'fa-regular fa-bookmark not-liked'"></i>
                </span>
                <el-checkbox v-model="item.selected" :ref="'checkbox-' + index"></el-checkbox>
                <el-image :src="'/file/' + item.name" :preview-src-list="['/file/' + item.name]" fit="cover" lazy="true"></el-image>
                <div class="image-overlay">
                  <div class="overlay-buttons">
                    <el-dropdown @command="(cmd) => handleQuickCopy(cmd, item.name)" trigger="click" size="mini">
                      <el-button size="mini" type="primary" @click.stop>{{ t('admin.copy') }} <i class="el-icon-arrow-down"></i></el-button>
                      <el-dropdown-menu slot="dropdown">
                        <el-dropdown-item command="url">{{ t('admin.directUrl') }}</el-dropdown-item>
                        <el-dropdown-item command="markdown">Markdown</el-dropdown-item>
                        <el-dropdown-item command="html">HTML</el-dropdown-item>
                        <el-dropdown-item command="bbcode">BBCode</el-dropdown-item>
                      </el-dropdown-menu>
                    </el-dropdown>
                    <el-button size="mini" type="info" @click.stop="handleEditName(item)">{{ t('admin.edit') }}</el-button>
                    <el-button size="mini" type="danger" @click.stop="handleDelete(index, item.name)">{{ t('admin.delete') }}</el-button>
                  </div>
              </div>
              <div class="card-footer">
                <el-popover
                  trigger="click"
                  placement="top"
                  popper-class="custom-popover">
                  <template #default>
                    <p v-html="formattedFileDetails(item)"></p>
                  </template>
                  <template #reference>
                    <span :style="{ color: item.metadata.ListType !== 'Block' ? '#fff' : '#aaa' }">
                      {{ item.metadata.fileName || item.name }}
                    </span>
                  </template>
                </el-popover>
              </div>
              </el-card>
            </template>
            <!-- 视频 - 根据实际文件类型渲染 -->
            <template v-else-if="getActualFileType(item.name) === 'video'">
              <el-card class="video-card" :class="{ 'selected': item.selected }" :draggable="true" @dragstart="handleFileDragStart(item, $event)" @dragend="handleFileDragEnd">
                <div class="video-content">
                  <video :src="'/file/' + item.name" controls style="width: 100%; height: 100%; object-fit: cover;"></video>
                  <div class="video-title">
                    <el-popover
                      trigger="click"
                      placement="top"
                      popper-class="custom-popover">
                      <template #default>
                        <p v-html="formattedFileDetails(item)"></p>
                      </template>
                      <template #reference>
                        <span :style="{ color: item.metadata.ListType !== 'Block' ? '#fff' : '#aaa' }">{{ item.metadata.fileName || item.name }}</span>
                      </template>
                    </el-popover>
                  </div>
                    <!-- 控制按钮区域 -->
                  <div class="video-controls">
                    <button class="control-btn like-btn" @click.stop="toggleLike(index, item.name)"><i :class="item.metadata.liked ? 'fas fa-heart liked' : 'far fa-heart'"></i></button>
                    <button class="control-btn edit-btn" @click.stop="handleEditName(item)"><i class="fas fa-edit"></i></button>
                    <button class="control-btn select-btn" @click.stop="toggleSelect(index, item.name)"><i :class="item.selected ? 'fas fa-square-check selected' : 'far fa-square'"></i></button>
                    <button class="control-btn" @click.stop="openPreview(item)" :title="t('admin.preview')"><i class="fas fa-eye"></i></button>
                    <button class="control-btn" @click.stop="handleCopy(index, item.name)"><i class="fas fa-link"></i></button>
                    <button class="control-btn" @click.stop="handleDelete(index, item.name)"><i class="fas fa-trash-alt"></i></button>
                  </div>
                </div>
              </el-card>
            </template>
            <!-- 音频 - 根据实际文件类型渲染 -->
            <template v-else-if="getActualFileType(item.name) === 'audio'">
              <el-card class="audio-card" :class="{ 'selected': item.selected }" :draggable="true" @dragstart="handleFileDragStart(item, $event)" @dragend="handleFileDragEnd">
                <div class="audio-content">
                  <!-- 音频标题区域 -->
                  <div class="audio-header">
                    <div class="audio-avatar">
                      <img src="./music.svg" alt="Music">
                    </div>
                    <div class="audio-info">
                      <div class="audio-title">
                        <el-popover
                          trigger="click"
                          placement="top"
                          popper-class="custom-popover">
                          <template #default>
                            <p v-html="formattedFileDetails(item)"></p>
                          </template>
                          <template #reference>
                            <span :style="{ color: item.metadata.ListType !== 'Block' ? '#fff' : '#aaa' }">{{ item.metadata.fileName || item.name }}</span>
                          </template>
                        </el-popover>
                      </div>
                      <div class="audio-subtitle">{{ getFileType(item.name) }}</div>
                    </div>
                  </div>
                  <audio
                    class="custom-audio-player"
                    :src="'/file/' + item.name"
                    controls
                    preload="metadata">
                    {{ t('admin.audioNotSupported') }}
                  </audio>
                  <!-- 控制按钮区域 -->
                  <div class="audio-controls">
                    <button class="control-btn like-btn" @click.stop="toggleLike(index, item.name)"><i :class="item.metadata.liked ? 'fas fa-heart liked' : 'far fa-heart'"></i></button>
                    <button class="control-btn edit-btn" @click.stop="handleEditName(item)"><i class="fas fa-edit"></i></button>
                    <button class="control-btn select-btn" @click.stop="toggleSelect(index, item.name)"><i :class="item.selected ? 'fas fa-square-check selected' : 'far fa-square'"></i></button>
                    <button class="control-btn" @click.stop="openPreview(item)" :title="t('admin.preview')"><i class="fas fa-eye"></i></button>
                    <button class="control-btn" @click.stop="handleCopy(index, item.name)"><i class="fas fa-copy"></i></button>
                    <button class="control-btn" @click.stop="handleDelete(index, item.name)"><i class="fas fa-trash-alt"></i></button>
                  </div>
                </div>
              </el-card>
            </template>
            <!-- 其他文件（文档等） - 默认渲染 -->
            <template v-else>
              <el-card class="file-card" :class="{ 'selected': item.selected }" :draggable="true" @dragstart="handleFileDragStart(item, $event)" @dragend="handleFileDragEnd">
                <div class="file-content">
                  <!-- 文件标题区域 -->
                  <div class="file-header">
                    <div class="file-avatar">
                      <i :class="getFileIcon(item.name)" style="font-size: 32px;"></i>
                    </div>
                    <div class="file-info">
                      <div class="file-title">
                        <el-popover
                          trigger="click"
                          placement="top"
                          popper-class="custom-popover">
                          <template #default>
                            <p v-html="formattedFileDetails(item)"></p>
                          </template>
                          <template #reference>
                            <span :style="{ color: item.metadata.ListType !== 'Block' ? '#fff' : '#aaa' }">{{ item.metadata.fileName || item.name }}</span>
                          </template>
                        </el-popover>
                      </div>
                      <div class="file-subtitle">{{ getFileType(item.name) }}</div>
                    </div>
                  </div>
                  <!-- 控制按钮区域 -->
                  <div class="file-controls">
                    <button class="control-btn like-btn" @click.stop="toggleLike(index, item.name)"><i :class="item.metadata.liked ? 'fas fa-heart liked' : 'far fa-heart'"></i></button>
                    <button class="control-btn edit-btn" @click.stop="handleEditName(item)"><i class="fas fa-edit"></i></button>
                    <button class="control-btn select-btn" @click.stop="toggleSelect(index, item.name)"><i :class="item.selected ? 'fas fa-square-check selected' : 'far fa-square'"></i></button>
                    <button class="control-btn" @click.stop="openPreview(item)" :title="t('admin.preview')"><i class="fas fa-eye"></i></button>
                    <button class="control-btn" @click.stop="handleCopy(index, item.name)"><i class="fas fa-copy"></i></button>
                    <button class="control-btn" @click.stop="handleDelete(index, item.name)"><i class="fas fa-trash-alt"></i></button>
                  </div>
                </div>
              </el-card>
            </template>
                </template>
                <div v-if="paginatedTableData.length === 0" class="empty-tip">
                  {{ t('admin.emptyTip') }}
                  <div>
                    <el-button size="mini" type="primary" @click="resetViewConditions">{{ t('admin.resetFilters') }}</el-button>
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="list-view-card">
                <el-table :data="paginatedTableData" border stripe row-key="name" style="width: 100%">
                  <el-table-column :label="t('admin.colSelect')" width="76" align="center">
                    <template slot-scope="scope">
                      <el-checkbox :value="scope.row.selected" @change="toggleSelectByName(scope.row.name)"></el-checkbox>
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colFileName')" min-width="280" show-overflow-tooltip>
                    <template slot-scope="scope">
                      <span class="row-drag-handle" draggable="true" @dragstart="handleFileDragStart(scope.row, $event)" @dragend="handleFileDragEnd">
                        <i class="fas fa-grip-lines"></i>
                      </span>
                      <span :style="{ color: scope.row.metadata.ListType === 'Block' ? '#999' : '' }">
                        {{ scope.row.metadata.fileName || scope.row.name }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colFolder')" width="180" show-overflow-tooltip>
                    <template slot-scope="scope">
                      {{ scope.row.metadata.folderPath || t('admin.rootDir') }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colType')" width="92" align="center">
                    <template slot-scope="scope">
                      {{ getFileType(scope.row.name) }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colSize')" width="116" align="right">
                    <template slot-scope="scope">
                      {{ formatFileSize(scope.row.metadata.fileSize || 0) }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colStorage')" width="126" align="center">
                    <template slot-scope="scope">
                      {{ getProfileLabel(scope.row) }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('admin.colActions')" width="236" fixed="right">
                    <template slot-scope="scope">
                      <div class="list-actions">
                        <el-button type="text" size="mini" @click="toggleLike(0, scope.row.name)">
                          {{ scope.row.metadata.liked ? t('admin.unfavorite') : t('admin.favorite') }}
                        </el-button>
                        <el-button type="text" size="mini" @click="handleCopy(0, scope.row.name)">{{ t('admin.copy') }}</el-button>
                        <el-button type="text" size="mini" @click="handleEditName(scope.row)">{{ t('admin.rename') }}</el-button>
                        <el-button type="text" size="mini" @click="openPreview(scope.row)">{{ t('admin.preview') }}</el-button>
                        <el-button type="text" size="mini" style="color:#f56c6c" @click="handleDelete(0, scope.row.name)">{{ t('admin.delete') }}</el-button>
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-if="paginatedTableData.length === 0" class="empty-tip">
                  {{ t('admin.emptyTip') }}
                  <div>
                    <el-button size="mini" type="primary" @click="resetViewConditions">{{ t('admin.resetFilters') }}</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div class="pagination-container">
              <el-pagination
                background layout="slot, prev, pager, next"
                :total="paginationTotal" :page-size="pageSize"
                @current-change="handlePageChange" :current-page.sync="currentPage">
                <span class="el-pagination__total">{{ t('admin.pageTotal', { n: paginationTotal }) }}</span>
              </el-pagination>
            </div>
            <div v-if="nextCursor" class="load-more-container">
              <el-button :loading="isLoadingMore" :disabled="isLoadingMore" @click="loadMore">
                {{ isLoadingMore ? t('admin.loading') : t('admin.loadMoreN', { loaded: Number, total: (totalCount || Number) }) }}
              </el-button>
            </div>
          </section>
        </div>
      </el-main>
    </el-container>`;
}
