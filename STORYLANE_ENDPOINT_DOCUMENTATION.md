# Storylane Capture API –  Guide

This guide is tailored for Storylane’s  workflow. It explains how to integrate the `POST /gif/capture` endpoint, recommended defaults, and best practices

---

## 1. Endpoint Overview

- **URL**: `POST https://api.pictify.io/gif/capture`
- **Auth**: Bearer token (Available on dashboard)
- **Content-Type**: `application/json`
- **Rate Cost**: 1.5 usage credits per successful request

> The legacy `/gif/storylane` endpoint continues to respond but is deprecated. New integrations should prefer `/gif/capture`.

---

## 2. Request Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | ✓ | – | Storylane share link to capture; must be publicly accessible. |
| `width` | integer | ✕ | 1280 | Controls viewport width (px); match demo device (`1280` desktop, `768` tablet, `414` mobile). |
| `height` | integer | ✕ | 720 | Controls viewport height (px); pair with width for consistent framing. |
| `frameDurationSeconds` | number | ✕ | 1 | Seconds each captured frame remains visible; 1–2s keeps tooltips legible. |
| `quality` | string | ✕ | `"medium"` | GIF preset controlling color depth/dithering (`"low"` drafts, `"medium"` balanced, `"high"` final assets). |

### Quality Presets

| Preset | Colors | Use Case | Notes |
|--------|--------|----------|-------|
| `low` | 128 | Quick QA loops, internal previews | Fastest encode, smallest files. |
| `medium` | 192 | Production stories, customer demos | Default balance of size vs. fidelity. |
| `high` | 256 | Marketing-ready gifs, color-sensitive UIs | Largest files; expect +20–30% processing time. |

### Time Compression (Automatic)

`timeCompressionFactor` is auto-managed; Storylane accounts typically run with factor `8` to condense slower demo interactions. The platform automatically slows playback during frame capture to avoid missing transient elements (toasts, modals, pointer highlights).

---

## 3. Example Requests


```bash
curl -X POST https://api.pictify.io/gif/capture \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer STORYLANE_TOKEN" \
  -d '{
    "url": "https://app.storylane.io/demo/xyz123",
    "width": 1280,
    "height": 720,
    "frameDurationSeconds": 1.8,
    "quality": "medium"
  }'
```


---

## 4. Response Contract

Successful responses return both persisted GIF metadata and rendering diagnostics.

```json
{
  "gif": {
    "uid": "WC3ML14NYO",
    "url": "https://media.pictify.io/0l53j-1760072726722.gif",
    "width": 1980,
    "height": 1080,
    "framesPerSecond": 1,
    "animationLength": 4,
    "frameDurationSeconds": 1,
    "quality": "low",
    "createdBy": "storylane_user_id",
    "createdAt": "2025-10-10T05:05:31.950Z"
  },
  "metadata": {
    "width": 1980,
    "height": 1080,
    "framesPerSecond": 1,
    "frameDurationSeconds": 1,
    "frameCount": 4,
    "animationLength": 4,
    "quality": "low",
    "uid": "0l53j-1760072726722"
  },
  "_meta": {
    "processingTime": 7792
  }
}
```

---

## 5. Error Handling

### Standard Errors

| HTTP | Code | Description | Storylane Guidance |
|------|------|-------------|---------------------|
| 400 | `MISSING_URL` | URL absent or malformed | Validate the Storylane share link before issuing requests. |
| 400 | `INVALID_QUALITY` | Quality preset not in (`low`, `medium`, `high`) | Fail fast. Default to `medium`. |
| 422 | `NO_FRAMES_CAPTURED` | No `capture_frame` events received | Confirm the embed sends `postMessage` events (`capture_frame`, `end`). |
| 500 | `INTERNAL_ERROR` | Unexpected renderer failure | Retry up to 3 times with exponential backoff. Capture logs for support. |
| 503 | `BROWSER_POOL_UNAVAILABLE` | Pool exhausted | Auto-retry after 5s. Storylane enterprise pool has higher concurrency but still finite. |

