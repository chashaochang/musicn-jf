# PR: Allow migu tasks without downloadUrl and resolve at download time

## Problem Statement

The frontend search results for migu service now return empty `downloadUrl` (Route 1: URL resolution deferred to download time), but the backend `/api/tasks` endpoint still enforces that `downloadUrl` must be provided. This causes task creation to fail with error: "Failed to create download task: Missing required field: downloadUrl".

## Solution Overview

This PR relaxes the validation rules to allow migu tasks to be created with empty `downloadUrl` when `copyrightId` is provided, while maintaining strict validation for non-migu services.

## Changes Made

### 1. Database Schema Update (`src/db/database.js`)

**Before:**
```sql
download_url TEXT NOT NULL
```

**After:**
```sql
download_url TEXT
```

**Reason:** Allows NULL values for downloadUrl to support migu tasks that resolve URLs at download time using copyrightId.

### 2. API Endpoint Validation (`src/server.js`, lines 102-123)

**Before:**
- Always required `downloadUrl` regardless of service type
- Would reject requests with empty `downloadUrl`

**After:**
- For **migu service**: Requires either `downloadUrl` OR `copyrightId`
- For **non-migu services**: Still requires `downloadUrl`
- Provides clear error messages for each validation failure case

**Code Logic:**
```javascript
// Determine service (default to 'migu')
const service = taskData.service || 'migu';

// Validate downloadUrl based on service
if (!taskData.downloadUrl || taskData.downloadUrl === '') {
  if (service === 'migu') {
    // Migu service can have empty downloadUrl if copyrightId is provided
    if (!taskData.copyrightId) {
      return res.status(400).json({
        error: 'Missing required field: downloadUrl or copyrightId',
        message: 'For migu service, either downloadUrl or copyrightId must be provided'
      });
    }
  } else {
    // Non-migu services require downloadUrl
    return res.status(400).json({
      error: 'Missing required field: downloadUrl',
      message: 'The downloadUrl field is required to create a download task'
    });
  }
}
```

### 3. Database Layer Validation (`src/db/database.js`, lines 151-163)

Applied the same validation logic in `createTask()` function to ensure consistency between API and database layers.

## Testing & Verification

### Automated Tests
✅ All 13 existing tests pass
- URL resolution tests
- Database schema tests
- Migu Route 1 tests

### Manual Testing

#### Test Case 1: Migu task with empty downloadUrl + valid copyrightId ✅
```bash
curl -X POST /api/tasks -d '{
  "service": "migu",
  "title": "Test Song",
  "artist": "Test Artist",
  "downloadUrl": "",
  "copyrightId": "60054701923",
  "contentId": "600543000007927466"
}'
```
**Result:** Task created successfully, enters `queued` status, then `downloading` as downloader attempts URL resolution.

#### Test Case 2: Migu task without downloadUrl or copyrightId ❌
```bash
curl -X POST /api/tasks -d '{
  "service": "migu",
  "title": "Test Song",
  "artist": "Test Artist",
  "downloadUrl": ""
}'
```
**Result:** Returns 400 error with message: "For migu service, either downloadUrl or copyrightId must be provided"

#### Test Case 3: Non-migu task without downloadUrl ❌
```bash
curl -X POST /api/tasks -d '{
  "service": "other",
  "title": "Test Song",
  "artist": "Test Artist",
  "downloadUrl": ""
}'
```
**Result:** Returns 400 error with message: "The downloadUrl field is required to create a download task"

#### Test Case 4: Non-migu task with valid downloadUrl ✅
```bash
curl -X POST /api/tasks -d '{
  "service": "other",
  "title": "Test Song",
  "artist": "Test Artist",
  "downloadUrl": "https://example.com/song.mp3"
}'
```
**Result:** Task created successfully with status `queued`.

### Downloader Integration

The existing downloader logic (`src/services/downloader.js`, lines 535-587) already handles migu tasks with empty `downloadUrl`:

1. Detects migu task with empty downloadUrl
2. Uses `copyrightId` to call `resolveMiguUrl()`
3. Tries multiple API endpoints and resourceTypes
4. Supports quality degradation (HQ → PQ → LQ)
5. On failure, provides detailed error message including:
   - All qualities attempted
   - All API endpoints tried
   - Specific error messages from each attempt
   - The copyrightId used

**Example Error Message:**
```
Failed to resolve Migu download URL after trying qualities: HQ, PQ, LQ. 
CopyrightId: 60054701923. 
Attempts: 
  - listenSong.do: Failed to resolve download URL: getaddrinfo ENOTFOUND app.c.nf.migu.cn
  - resourceinfo.do?resourceType=2: getaddrinfo ENOTFOUND c.musicapp.migu.cn
  - resourceinfo.do?resourceType=0: getaddrinfo ENOTFOUND c.musicapp.migu.cn
  - resourceinfo.do?resourceType=E: getaddrinfo ENOTFOUND c.musicapp.migu.cn
```

## Migration Notes

### Backward Compatibility
✅ **Fully backward compatible**
- Existing migu tasks with valid `downloadUrl` continue to work
- Existing non-migu tasks are unaffected
- Database migration is automatic (column already existed with NOT NULL, just removed the constraint in schema)

### Frontend Compatibility
✅ **Already compatible**
- Frontend already passes `copyrightId`, `contentId`, and `rawFormat` (see `public/app.js`, lines 242-244)
- No frontend changes required

## Acceptance Criteria

✅ Clicking download button successfully creates task (no longer reports missing downloadUrl)
✅ Task enters `queued` status, then `downloading` as downloader picks it up
✅ If URL resolution fails, task enters `failed` status with detailed error message
✅ Error messages explain what was tried and why it failed (useful for users without backend access)
✅ Non-migu services maintain strict downloadUrl validation
✅ All existing tests pass

## Files Modified

1. `src/db/database.js` - Database schema and validation logic
2. `src/server.js` - API endpoint validation logic

**Total:** 2 files changed, 39 insertions(+), 11 deletions(-)

## Verification Commands

```bash
# Run tests
npm test

# Start server
npm start

# Test creating migu task without downloadUrl
curl -X POST http://localhost:17890/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"service":"migu","title":"Test","artist":"Test","downloadUrl":"","copyrightId":"123"}'

# Check task status
curl http://localhost:17890/api/tasks/1
```
