# Storylane GIF Endpoint Documentation

## Endpoint Details

- **URL**: `POST https://api.pictify.io/gif/storylane`
- **Auth**: Bearer Token (Required)
- **Content-Type**: `application/json`

> ⚠️ Only available to authorized accounts. Each request consumes **1.5 usage credits**.

---

## Parameters

### `url` (Required)

- **Type**: `string`
- **Description**: The public Storylane demo URL to capture.
- **Validation**: Must be a valid and reachable HTTPS URL.

**Example:**
```json
"url": "https://app.storylane.io/demo/xyz123"
```

### `frameDurationSeconds` (Optional)

- **Type**: `number`
- **Description**: Duration (in seconds) for which each frame remains visible in the final GIF.
- **Default**: `1` second
- **Validation**:
  - Must be greater than 0
  - Non-numeric or invalid values are ignored

**Example:**
```json
"frameDurationSeconds": 2.5
```

> ⏱️ **Note**: A higher `frameDurationSeconds` makes each step appear longer, improving clarity but increasing processing time.

---

## Example Request

```bash
curl -X POST https://api.pictify.io/gif/storylane \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{
    "url": "https://app.storylane.io/demo/xyz123",
    "frameDurationSeconds": 2
  }'
```

---

## Example Response (200 OK)

```json
{
  "gif": {
    "url": "https://media.pictify.io/generated-gif.gif",
    "width": 1280,
    "height": 720,
    "framesPerSecond": 30,
    "animationLength": 10,
    "createdBy": "user_12345",
    "timeCompressionFactor": 1,
    "frameDurationSeconds": 2
  },
  "metadata": {
    "width": 1280,
    "height": 720,
    "framesPerSecond": 30,
    "animationLength": 10,
    "frameCount": 300
  },
  "_meta": {
    "processingTime": 12500
  }
}
```

---

# Example Output

[https://media.pictify.io/tqcpt-1759787965482.gif](https://media.pictify.io/tqcpt-1759787965482.gif)

## Error Responses

| Status | Error Example | Description |
|--------|---------------|-------------|
| 400 Bad Request | `{ "error": "URL is required" }` | Missing or invalid parameters |
| 403 Forbidden | `{ "error": "Forbidden" }` | Invalid API token or unauthorized access |
| 422 Unprocessable Entity | `{ "error": "No frames captured" }` | No renderable frames were found |
| 500 Internal Server Error | `{ "error": "Failed to create GIF" }` | Unexpected system error or renderer timeout |

---

## Response Details

### `gif` Object

| Field | Description |
|-------|-------------|
| `url` | CDN-delivered URL of the generated GIF |
| `width` | Output width in pixels |
| `height` | Output height in pixels |
| `framesPerSecond` | Internal playback speed used during rendering |
| `animationLength` | Total duration (seconds) |
| `timeCompressionFactor` | Multiplier used to compress real-time playback |
| `frameDurationSeconds` | Duration per frame actually used |

### `metadata` Object

Technical rendering information including:
- Frame count
- Dimensions
- Processing parameters

Used for debugging and analytics.

### `_meta` Object

| Field | Description |
|-------|-------------|
| `processingTime` | Total time to generate GIF (milliseconds) |