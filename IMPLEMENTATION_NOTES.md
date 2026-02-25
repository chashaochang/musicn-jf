# Migu Search API Fix - Implementation Notes

## Problem
The original implementation used `m.music.migu.cn/migu/remoting/scr_search_tag` which was returning HTML instead of JSON, causing parse errors: `Unexpected token '<'`.

## Solution
Replaced the old endpoint with Migu's proper JSON API at `pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do`.

## Changes Made

### 1. Updated API Endpoint (`src/services/migu.js`)
- **Old**: `https://m.music.migu.cn/migu/remoting/scr_search_tag`
- **New**: `https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do`

### 2. Enhanced Request Headers
Added comprehensive headers to improve success rate and avoid anti-scraping blocks:
```javascript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://music.migu.cn/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Origin': 'https://music.migu.cn'
}
```

### 3. Request Parameters
Updated to match the new API's expected format:
- `text` (instead of `keyword`)
- `pageNo` (instead of `pgc`)
- `pageSize` (instead of `rows`)
- `searchSwitch` - JSON object controlling search types

### 4. Response Handling
- Set `responseType: 'text'` to detect HTML responses before parsing
- Added JSON parse validation with try-catch
- Validate response code (`code === '000000'` for success)
- Extract results from `data.songResultData.result`

### 5. Error Handling Improvements

#### In `migu.js`:
- Detect non-JSON responses (HTML from anti-scraping)
- Validate API response structure
- Distinguish network errors from API errors
- Provide clear, actionable error messages

#### In `server.js`:
- Return 502 (Bad Gateway) for upstream service issues
- Include diagnostic information in error responses
- Add suggestions for users to troubleshoot
- Keep 500 (Internal Server Error) for other errors

### 6. Data Transformation Functions

Added/improved helper functions:

#### `normalizeCoverUrl()`
- Converts HTTP to HTTPS
- Handles protocol-relative URLs (`//example.com`)

#### `formatFileSize()`
- Converts bytes to MB with 2 decimal places
- Handles pre-formatted string sizes
- Returns "Unknown" for missing/zero values

#### `getFormat()`
- Maps format codes to readable names:
  - `SQ` → `FLAC`
  - `HQ` → `MP3 320K`
  - `PQ` → `MP3 128K`
- Handles `rateFormats` arrays
- Falls back to "MP3"

### 7. Documentation (`README.md`)
Added comprehensive troubleshooting section covering:
- Common causes of search failures
- Network connectivity checks
- DNS resolution verification
- How to update headers if needed
- Developer guidance for API changes

## Output Structure
The output structure remains compatible with the frontend:
```json
{
  "service": "migu",
  "query": "search text",
  "pageNum": 1,
  "pageSize": 20,
  "results": [
    {
      "id": "...",
      "title": "...",
      "artist": "...",
      "album": "...",
      "coverUrl": "...",
      "downloadUrl": "...",
      "fileSize": "...",
      "format": "..."
    }
  ]
}
```

## Error Responses

### 400 Bad Request
Missing required parameters:
```json
{
  "error": "Missing required parameter: text"
}
```

### 502 Bad Gateway
Upstream service issues:
```json
{
  "error": "Upstream service error",
  "message": "Upstream API returned HTML instead of JSON. Possible anti-scraping measures or API changes.",
  "suggestion": "The music service may be temporarily unavailable or blocking requests. Please try again later or check the troubleshooting guide."
}
```

## Testing
Created comprehensive test suite (`/tmp/test-migu-logic.js`) that validates:
- JSON parsing and validation ✓
- Error detection for HTML responses ✓
- API error response handling ✓
- Empty results handling ✓
- HTTP to HTTPS conversion ✓
- Protocol-relative URL handling ✓
- File size formatting ✓
- Format code mapping ✓
- Artist name extraction ✓

All tests pass successfully.

## Security Considerations
- No sensitive information leaked in error messages
- Input validation maintained (text parameter required)
- Timeout set to 10 seconds to prevent hanging
- User-Agent updated to current browser version

## Future Maintenance
If the API changes or gets blocked:
1. Check browser DevTools Network tab at https://music.migu.cn
2. Update the API endpoint in `src/services/migu.js`
3. Update headers to match current browser requests
4. Verify response structure and update data extraction logic
5. Test with the provided test script

## Backward Compatibility
✓ Frontend compatibility maintained - no changes needed to `public/app.js`
✓ Server API endpoints unchanged
✓ Data structure for results array preserved
✓ Task creation flow unaffected
