# Migu Search copyrightId Fix

## Problem
The Migu search results were all grayed out (disabled=true) because the `/api/search` endpoint was not returning the `copyrightId` and `contentId` fields explicitly. This caused the `directUrl` generation logic to fail.

## Root Cause
In the `searchMigu` function (`src/services/migu.js`), the mapping of search results was only setting:
```javascript
id: item.id || item.contentId || item.copyrightId
```

This meant that:
1. When the upstream API returned items with `id: "2410"` (a simple numeric ID), that value was used
2. The actual `copyrightId` and `contentId` from the API were not included in the response
3. The `directUrl` generation via `resourceinfo.do` requires the actual `copyrightId` to work
4. Without proper copyrightId, the directUrl would be malformed or empty, causing `disabled: true`

## Solution
Added explicit mapping of `copyrightId` and `contentId` fields in the search result object:

```javascript
return {
  id: item.id || item.contentId || item.copyrightId,
  copyrightId: item.copyrightId, // Explicitly return copyrightId from API
  contentId: item.contentId, // Explicitly return contentId from API
  title: item.name || item.songName || 'Unknown',
  // ... rest of fields
};
```

## Changes Made
1. **src/services/migu.js** (lines 100-101): Added `copyrightId` and `contentId` fields to the returned object
2. **test/migu.test.js**: Added unit tests to verify:
   - copyrightId and contentId are included in search results
   - resourceinfo URL generation uses the correct copyrightId
   - Missing fields are handled gracefully

## How It Works
1. Migu's `search_all.do` API returns song objects with `copyrightId` and `contentId`
2. For each song, we fetch resourceinfo using: 
   ```
   https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId={copyrightId}&resourceType=2
   ```
3. The resourceinfo response contains `audioUrl` which is parsed to construct the `directUrl`
4. Now that copyrightId is explicitly passed through, the directUrl generation works correctly
5. When directUrl is valid, `disabled` is set to `false`, making the download buttons active

## Verification
All tests pass:
```bash
npm test
# ✔ Migu search result includes copyrightId and contentId fields
# ✔ Migu resourceinfo URL generation uses copyrightId
# ✔ Migu search handles missing copyrightId gracefully
```

## Impact
- ✅ Search results will now include `copyrightId` and `contentId` fields
- ✅ DirectUrl generation will work correctly
- ✅ Download buttons will no longer be grayed out (assuming valid copyrightId from API)
- ✅ Backward compatible - `id` field is still included for frontend compatibility
