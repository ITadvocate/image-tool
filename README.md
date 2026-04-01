# Image Tool

Node.js image processing service built with Express, `sharp`, and Docker Compose.

It supports two practical use cases:

1. A generic image converter/optimizer with upload, batch processing, resizing, format conversion, and zip download.
2. A product-image microservice for existing PHP e-commerce platforms, with pre-generated commerce sizes, contextual crops, watermarking, rule-based ALT text, and device-aware delivery.

## What this project does

### Generic image workflow

- upload one or many images
- convert to `jpeg`, `jpg`, `png`, `webp`, `avif`, or `tiff`
- generate multiple preset outputs in one request
- add optional custom width/height output
- tune quality, aspect ratio, and metadata stripping
- download individual files or a zip for the full batch

### E-commerce product image workflow

- store immutable original product images
- generate standard product variants automatically:
  - `thumbnail`
  - `listing`
  - `product`
  - `zoom`
- generate context variants:
  - `square`
  - `vertical`
  - `horizontal`
- generate rule-based ALT text from product metadata
- apply optional watermark rules
- serve pre-generated or dynamic variants based on device and URL params
- integrate with an existing PHP site without rewriting current product logic

## Stack

- Node.js 18+
- Express
- sharp
- multer
- Docker Compose

## Project structure

```text
.
├── Dockerfile
├── docker-compose.yml
├── docs/
│   └── ecommerce-image-microservice.md
├── public/
├── processed/
├── src/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   └── utils/
├── temp/
├── uploads/
├── package.json
└── server.js
```

## Quick start

### Docker

```bash
docker-compose up --build
```

### One-command bootstrap script

The root deploy script can:

- check whether the app files already exist in the same folder
- fetch the source from GitHub if they are missing
- create the Docker network if it does not exist
- launch the app with Docker Compose

```bash
chmod +x deploy.sh
./deploy.sh
```

By default it fetches from:

`https://github.com/ITadvocate/image-tool.git`

You can override that:

```bash
REPO_URL=https://github.com/ITadvocate/image-tool.git ./deploy.sh
```

### Local

```bash
npm install
npm start
```

App URLs:

- UI: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/health](http://localhost:3000/health)

## Environment variables

Copy `.env.example` if you want custom values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `COMPOSE_NETWORK_NAME` | `image-tool-network` | External Docker network name |
| `MAX_FILE_SIZE_BYTES` | `5242880` | Per-file upload limit |
| `MAX_BATCH_FILES` | `20` | Max files per upload |
| `TEMP_FILE_TTL_MS` | `3600000` | Temp file retention |
| `CLEANUP_INTERVAL_MS` | `900000` | Cleanup interval |
| `BATCH_RECORD_TTL_MS` | `86400000` | In-memory batch record retention |
| `DYNAMIC_CACHE_MAX_AGE_SECONDS` | `604800` | Cache lifetime for generated delivery assets |
| `WRITE_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window for write endpoints |
| `WRITE_RATE_LIMIT_MAX` | `120` | Max write requests per window |
| `WATERMARK_LOGO_PATH` | empty | Optional watermark logo path |
| `WATERMARK_TEXT` | empty | Fallback text watermark |

## Generic converter API

### `POST /upload`

Multipart upload for one or more images:

```bash
curl -X POST http://localhost:3000/upload \
  -F "images=@/absolute/path/to/image-1.jpg" \
  -F "images=@/absolute/path/to/image-2.png"
```

### `POST /process`

Generate one or more outputs from an uploaded batch:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "upload-batch-id",
    "format": "webp",
    "quality": 80,
    "maintainAspectRatio": true,
    "stripMetadata": true,
    "resizePresets": ["thumb", "medium"],
    "resize": {
      "width": 800,
      "height": 600
    }
  }'
```

Notes:

- `resizePresets` can contain multiple values
- custom `resize.width` and `resize.height` add one more output variant
- if no resize options are given, the original dimensions are preserved

### `GET /batches/:batchId`

Returns processing status and output URLs.

### `GET /download/:file`

Downloads a single processed file.

### `GET /download-zip/:batchId`

Downloads all processed files for the batch as a zip.

## Product image microservice API

These endpoints are meant for an existing PHP e-commerce backend.

### `POST /api/products/images/upload`

Uploads product images, stores originals, and optionally auto-generates variants.

Multipart fields:

- `images`: required file array
- `productId`: required
- `productName`
- `brand`
- `category`
- `attributes`: JSON string
- `roles`: comma-separated roles such as `primary,side,back`
- `autoProcess`: `true` or `false`
- `profiles`: optional comma-separated profile keys
- `format`
- `quality`
- `watermarkEnabled`
- `watermarkPosition`
- `watermarkOpacity`
- `watermarkText`

Example:

```bash
curl -X POST http://localhost:3000/api/products/images/upload \
  -F "productId=SKU-1001" \
  -F "productName=Air Max 90" \
  -F "brand=Nike" \
  -F "category=Shoes" \
  -F 'attributes={"color":"Black","type":"Sneakers","gender":"Men"}' \
  -F "roles=primary,side" \
  -F "images=@/absolute/path/to/primary.jpg" \
  -F "images=@/absolute/path/to/side.jpg"
```

### `POST /api/products/images/process`

Reprocesses existing product images using updated rules.

```bash
curl -X POST http://localhost:3000/api/products/images/process \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "SKU-1001",
    "productName": "Air Max 90",
    "brand": "Nike",
    "category": "Shoes",
    "attributes": {
      "color": "Black",
      "type": "Sneakers",
      "gender": "Men"
    },
    "profiles": ["thumbnail", "listing", "product", "zoom", "square"],
    "format": "webp",
    "quality": 82,
    "watermark": {
      "enabled": true,
      "position": "southeast",
      "opacity": 0.15
    }
  }'
```

### `GET /api/products/:productId/manifest`

Returns the product-level manifest with originals, variants, ALT text, and URLs.

### `GET /api/products/:productId/images/:imageId/meta`

Returns metadata for one product image.

### `GET /api/products/:productId/images/:imageId`

Delivers the image asset.

Common query params:

- `variant=thumbnail|listing|product|zoom|square|vertical|horizontal`
- `device=mobile|tablet|desktop`
- `format=auto|webp|avif|jpeg|png`
- `width`
- `height`
- `quality`
- `fit=cover|inside|fill`

Example:

```bash
curl "http://localhost:3000/api/products/SKU-1001/images/<image-id>?variant=product&device=mobile&format=auto"
```

## Storage layout

### Generic uploads

- `uploads/`
- `processed/`
- `temp/`

### Product images

```text
uploads/products/<product-slug>/manifest.json
uploads/products/<product-slug>/<image-id>/original.<ext>

processed/products/<product-slug>/<image-id>/<product-slug>-<image-id>-<role>-<variant>.<ext>
processed/products/<product-slug>/<image-id>/dynamic/<variant>-<hash>.<ext>
```

## Integration notes for PHP projects

- keep the current PHP upload flow
- call the Node service after upload
- store returned `imageId`, ALT text, and image URLs in a side table or JSON column
- switch templates gradually behind feature flags
- keep original legacy images as fallback until rollout is complete

The full architecture and rollout plan is documented in:

- [docs/ecommerce-image-microservice.md](docs/ecommerce-image-microservice.md)

## Safety and stability

- validates actual image content using `sharp`
- limits upload file size and batch size
- applies in-memory write rate limiting
- serializes heavy processing through a simple queue
- preserves originals
- falls back to the original asset if delivery transformation fails

## Notes

- The generic converter UI is available from the browser at `/`
- The generic converter endpoints are still available even with the e-commerce layer enabled
- Docker Compose config is included, but Docker Desktop must be running on your machine for `docker-compose up --build` to work

## License

This project is licensed under the GNU Affero General Public License v3.0.

- Full text: [LICENSE](LICENSE)
- SPDX identifier: `AGPL-3.0-only`
