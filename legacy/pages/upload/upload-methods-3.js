{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async processFiles(files, imageCompressOptions, uploadContext) {
            if (!files || files.length === 0) return;
            const context = uploadContext || this.createUploadContext();
            const compressOptions =
              imageCompressOptions ||
              this.snapshotImageCompressOptions(this.imageCompress.enabled);

            // 添加到上传队列
            for (const file of files) {
              const uploadItem = {
                name: file.name,
                size: file.size,
                file: file,
                originalFile: file,
                originalName: file.name,
                originalSize: file.size,
                status: "waiting",
                preview: null,
                progress: 0,
                error: null,
                compressionStatus: "",
                imageCompressionPrepared: false,
                imageCompressOptions: { ...compressOptions },
                uploadTarget: context,
                storageTarget: `${context.storageMode} · ${context.storageName}`,
                isChunked: false,
              };

              // 生成预览
              if (file.type.startsWith("image/")) {
                uploadItem.preview = URL.createObjectURL(file);
              }

              this.uploadingFiles.push(uploadItem);
            }

            // 开始上传
            await this.startUpload();
          }
  }});
}
