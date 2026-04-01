# E-commerce Image Microservice Blueprint

This service is designed to sit beside an existing PHP storefront and handle product-image optimization without changing catalog, checkout, pricing, or any current product-page logic.

## 1. System Architecture

### Components

- PHP e-commerce app:
  - keeps owning product CRUD, admin auth, and current upload UI
  - calls the image service after product image upload
  - stores returned `imageId`, URLs, and ALT text in existing product tables or a new side table
- Node.js image microservice:
  - validates uploads
  - stores originals
  - generates standard commerce + context variants
  - applies watermark rules
  - serves pre-generated and dynamic variants
  - falls back to originals if a transform fails
- Shared or local storage:
  - originals under `uploads/products/<product-slug>/<imageId>/`
  - generated assets under `processed/products/<product-slug>/<imageId>/`
- CDN / reverse proxy:
  - caches `GET /api/products/:productId/images/:imageId`
  - respects long cache headers for immutable generated assets

### Runtime flow

1. PHP uploads images to the Node service.
2. Node stores originals and writes a product manifest.
3. Node pre-generates standard variants:
   - `thumbnail`
   - `listing`
   - `product`
   - `zoom`
   - `square`
   - `vertical`
   - `horizontal`
4. PHP stores the returned metadata and uses the service URLs in templates.
5. Frontend requests the image delivery endpoint with `variant`, `device`, and optional `format`.
6. The service serves:
   - pre-generated variant if it matches
   - cached dynamic transform if already built
   - fresh dynamic transform if needed
   - original image if generation fails

## 2. Image Processing Workflow

### Upload -> Transform -> Serve

1. Upload:
   - PHP sends product context and one or more product images.
   - The service validates file size, actual image format, and upload limits.
2. Normalize:
   - Product metadata is normalized:
     - product name
     - brand
     - category
     - attributes
     - watermark rules
3. Store original:
   - The original file is saved once and never overwritten.
4. Generate derivatives:
   - Commerce sizes for product cards and PDP
   - Context crops for banners, grids, and sliders
   - Optional watermark overlay
   - Rule-based ALT text generation
5. Serve:
   - Pre-generated files are preferred
   - Device-aware or URL-driven resizing uses dynamic cached derivatives

## 3. Storage Strategy

### Folder structure

```text
uploads/
  products/
    <product-slug>/
      manifest.json
      <image-id>/
        original.jpeg

processed/
  products/
    <product-slug>/
      <image-id>/
        <product-slug>-<image-id>-primary-thumbnail.webp
        <product-slug>-<image-id>-primary-listing.webp
        <product-slug>-<image-id>-primary-product.webp
        <product-slug>-<image-id>-primary-zoom.webp
        <product-slug>-<image-id>-primary-square.webp
        <product-slug>-<image-id>-primary-vertical.webp
        <product-slug>-<image-id>-primary-horizontal.webp
        dynamic/
          product-<hash>.webp
          listing-<hash>.avif
```

### Why this works

- originals are immutable
- variants are grouped by product and image
- manifests make integration simple without a database dependency
- cached dynamic files can be purged independently

## 4. API Design

### `POST /api/products/images/upload`

Use this from the PHP admin upload flow.

Multipart fields:

- `images`: file array
- `productId`: required
- `productName`
- `brand`
- `category`
- `attributes`: JSON string
- `roles`: comma-separated roles like `primary,side,back`
- `autoProcess`: `true|false`
- `profiles`: optional comma-separated profile keys
- `format`: output format, default `webp`
- `quality`: default `82`
- `watermarkEnabled`
- `watermarkPosition`
- `watermarkOpacity`
- `watermarkText`

Returns:

- stored originals
- generated variants when `autoProcess=true`
- ALT text
- delivery URLs

### `POST /api/products/images/process`

Use for reprocessing after:

- brand watermark change
- category rule change
- migration to `avif`
- improved profile settings

JSON body:

- `productId`
- `imageIds`: optional array
- `profiles`
- `format`
- `quality`
- `watermark`

### `GET /api/products/:productId/manifest`

Returns the product’s image inventory, source metadata, ALT text, and generated variants.

### `GET /api/products/:productId/images/:imageId/meta`

Returns one image record including source metadata and generated variants.

### `GET /api/products/:productId/images/:imageId`

Delivery endpoint.

Query params:

- `variant=thumbnail|listing|product|zoom|square|vertical|horizontal`
- `device=mobile|tablet|desktop`
- `format=auto|webp|avif|jpeg|png`
- `width`
- `height`
- `quality`
- `fit=cover|inside|fill`

## 5. Naming Conventions

### Originals

- `original.<ext>`

### Pre-generated variants

- `<product-slug>-<image-id>-<role>-thumbnail.webp`
- `<product-slug>-<image-id>-<role>-listing.webp`
- `<product-slug>-<image-id>-<role>-product.webp`
- `<product-slug>-<image-id>-<role>-zoom.webp`
- `<product-slug>-<image-id>-<role>-square.webp`
- `<product-slug>-<image-id>-<role>-vertical.webp`
- `<product-slug>-<image-id>-<role>-horizontal.webp`

### Dynamic cache

- `<variant>-<hash>.<ext>`

This keeps URLs deterministic enough for debugging while avoiding collisions.

## 6. Device-Based Delivery Strategy

### Default mapping

- mobile:
  - listing `320px`
  - product `640px`
  - zoom `960px`
- tablet:
  - listing `480px`
  - product `900px`
  - zoom `1280px`
- desktop:
  - listing `640px`
  - product `1200px`
  - zoom `1800px`

### Serving rules

- if a pre-generated variant is already small enough, serve it directly
- if the request needs a smaller or different format asset, generate a cached derivative
- default to `avif` or `webp` when the browser supports it
- set long cache headers for generated assets

## 7. ALT Text Logic

Rule-based generation only, no AI dependency.

### Template

`<brand>, <product name>, <type>, <category>, <color>, <gender collection>, <role view>`

Example:

`Nike, Air Max 90, sneakers, shoes, black, men collection, primary view`

Variant ALT text extends the base:

- `... thumbnail image`
- `... product detail image`
- `... vertical banner image`

## 8. Watermark Strategy

### Rules

- disabled by default unless category or product settings enable it
- product-level request can override category defaults
- configurable:
  - `northwest`
  - `northeast`
  - `southwest`
  - `southeast`
  - `center`
- configurable opacity
- supports:
  - logo file via `WATERMARK_LOGO_PATH`
  - text fallback via `WATERMARK_TEXT` or request payload

### Recommended use

- enable on marketplace/catalog exports
- disable on zoom images if brand wants clean PDP zoom later
- keep opacity low to avoid hurting conversion

## 9. Safety and Stability

- strict file size limit
- actual image validation using `sharp`, not extension trust
- in-memory write rate limiting for abuse protection
- original asset fallback on transform failure
- queueing to avoid uncontrolled concurrent CPU spikes
- no PHP-side rewrite needed

## 10. Safe Rollout Plan

1. Phase 1:
   - keep current PHP image flow unchanged
   - call the Node upload endpoint in parallel for selected categories only
   - store returned URLs in a shadow table or JSON field
2. Phase 2:
   - switch listing pages to the Node service URLs behind a feature flag
   - keep PDP and zoom on legacy images
3. Phase 3:
   - switch PDP/product images
   - enable device-aware serving
4. Phase 4:
   - enable context crops for banners and recommendation widgets
5. Phase 5:
   - backfill old catalog images using `POST /api/products/images/process`

## 11. Operational Notes

- target under 2 seconds per image by:
  - pre-generating standard profiles at upload time
  - caching dynamic transforms
  - serializing heavy writes
- put a CDN in front before internet-scale traffic
- move manifests to a database only after file-based metadata becomes a real bottleneck
