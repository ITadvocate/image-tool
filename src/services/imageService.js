const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const { PROCESSED_DIR } = require("../utils/config");
const { buildStoredName, sanitizeBaseName } = require("./fileService");

function getResizeConfig(resize, maintainAspectRatio) {
  if (!resize) {
    return null;
  }

  return {
    width: resize.width,
    height: resize.height,
    fit: maintainAspectRatio ? "inside" : "fill",
    withoutEnlargement: true
  };
}

function applyOutputFormat(pipeline, options) {
  const { sharpFormat } = options.format;

  switch (sharpFormat) {
    case "jpeg":
      return pipeline.jpeg({
        quality: options.quality,
        mozjpeg: true
      });
    case "png":
      return pipeline.png({
        compressionLevel: Math.max(0, Math.min(9, Math.round((100 - options.quality) / 10))),
        quality: options.quality
      });
    case "webp":
      return pipeline.webp({
        quality: options.quality
      });
    case "avif":
      return pipeline.avif({
        quality: options.quality,
        effort: 4
      });
    case "tiff":
      return pipeline.tiff({
        quality: options.quality,
        compression: options.quality >= 90 ? "lzw" : "jpeg"
      });
    default:
      return pipeline;
  }
}

async function processSingleFile(inputFile, processBatchId, options) {
  const baseName = sanitizeBaseName(inputFile.originalName);
  const prefix = options.output.prefix || "";
  const outputName = buildStoredName(
    `${prefix}${baseName}-${processBatchId}`,
    options.format.extension
  );
  const outputPath = path.join(PROCESSED_DIR, outputName);

  let pipeline = sharp(inputFile.path).rotate();
  const resizeConfig = getResizeConfig(options.output, options.maintainAspectRatio);

  if (resizeConfig) {
    pipeline = pipeline.resize(resizeConfig);
  }

  if (!options.stripMetadata) {
    pipeline = pipeline.withMetadata();
  }

  pipeline = applyOutputFormat(pipeline, options);
  await pipeline.toFile(outputPath);

  const [metadata, stats] = await Promise.all([sharp(outputPath).metadata(), fs.stat(outputPath)]);

  return {
    inputFileId: inputFile.id,
    originalName: inputFile.originalName,
    variant: {
      key: options.output.key,
      type: options.output.type,
      label: options.output.label,
      preset: options.output.preset,
      width: options.output.width,
      height: options.output.height
    },
    fileName: outputName,
    path: outputPath,
    format: options.format.requestedFormat,
    width: metadata.width,
    height: metadata.height,
    size: stats.size
  };
}

async function processBatchFiles({ processBatchId, files, options, onProgress }) {
  const processedFiles = [];
  const totalOutputs = files.length * options.outputs.length;
  let completedOutputs = 0;

  for (const file of files) {
    for (const output of options.outputs) {
      const processedFile = await processSingleFile(file, processBatchId, {
        ...options,
        output
      });
      processedFiles.push(processedFile);
      completedOutputs += 1;

      if (onProgress) {
        onProgress(completedOutputs, totalOutputs);
      }
    }
  }

  return processedFiles;
}

module.exports = {
  processBatchFiles
};
