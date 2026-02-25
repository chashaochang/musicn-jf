import got from 'got';

/**
 * Search music on Migu platform using JSON API
 */
export async function searchMigu(text, pageNum = 1, pageSize = 20) {
  try {
    // Use Migu's proper JSON search API (MIGUM3.0)
    const url = 'https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do';
    
    const searchParams = {
      text: text,
      pageNo: pageNum,
      pageSize: pageSize,
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 0, mvSong: 0, bestShow: 0, songlist: 0, bestShow: 0 })
    };
    
    const response = await got.get(url, {
      searchParams,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://music.migu.cn/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Origin': 'https://music.migu.cn'
      },
      timeout: { request: 10000 },
      responseType: 'text' // Get raw text first to handle potential HTML responses
    });
    
    // Check if response is actually JSON
    let data;
    try {
      data = JSON.parse(response.body);
    } catch (parseError) {
      console.error('Migu API returned non-JSON response:', response.body.substring(0, 200));
      throw new Error('Upstream API returned HTML instead of JSON. Possible anti-scraping measures or API changes.');
    }
    
    // Check response structure
    if (!data || data.code !== '000000') {
      const errorMsg = data?.info || 'Unknown error from upstream API';
      console.error('Migu API error response:', data);
      throw new Error(`Upstream API error: ${errorMsg}`);
    }
    
    // Parse song results
    const songs = data.songResultData?.result || [];
    
    if (songs.length === 0) {
      return [];
    }
    
    // Route 1: Don't resolve directUrl during search
    // Just return essential metadata and let download task resolve the URL
    return songs.map((item) => {
      const rawFormat = item.format || item.formatType || item.rateFormats;
      const { format } = getFormatAndSize(item, rawFormat);
      
      // Extract copyrightId - required for URL resolution during download
      const copyrightId = item.copyrightId || item.id || item.contentId;
      const contentId = item.contentId || item.id || item.copyrightId;
      
      // Only disable if critical identifiers are missing
      const disabled = !copyrightId;
      
      // Prioritize imgItems[].img for cover URL, with fallbacks
      let coverUrl = '';
      if (item.imgItems && Array.isArray(item.imgItems) && item.imgItems.length > 0) {
        // Try to find a suitable size (500 or 400 preferred, fallback to first)
        const img500 = item.imgItems.find(img => img.img && img.img.includes('500'));
        const img400 = item.imgItems.find(img => img.img && img.img.includes('400'));
        const firstImg = item.imgItems.find(img => img.img);
        coverUrl = (img500 || img400 || firstImg)?.img || '';
      }
      // Fallback to other cover fields
      if (!coverUrl) {
        coverUrl = item.cover || item.albumImgs || item.largePic || '';
      }
      
      return {
        id: item.id || contentId,
        copyrightId: copyrightId,
        contentId: contentId,
        title: item.name || item.songName || 'Unknown',
        artist: item.singers?.map(s => s.name).join(', ') || item.singer || 'Unknown Artist',
        album: item.albums?.[0]?.name || item.albumName || '',
        coverUrl: normalizeCoverUrl(coverUrl),
        downloadUrl: '', // Empty - will be resolved during download
        disabled: disabled,
        fileSize: '', // Don't show file size per user requirement
        format: format,
        // Keep raw format data and IDs for URL resolution during download
        rawFormat: rawFormat
      };
    });
    
  } catch (error) {
    // Distinguish between network errors and API errors
    if (error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT')) {
      console.error('Migu search network error:', error.message);
      throw new Error('Network error: Unable to reach Migu API. Check DNS and network connectivity.');
    }
    
    console.error('Migu search error:', error.message);
    throw error;
  }
}

/**
 * Normalize cover URL to use HTTPS
 */
function normalizeCoverUrl(url) {
  if (!url) return '';
  
  // Convert http to https
  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }
  
  // Handle relative URLs
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  return url;
}

/**
 * Format file size to human-readable format
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return 'Unknown';
  
  // If already formatted as string, return as is
  if (typeof bytes === 'string') return bytes;
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  
  return size.toFixed(2) + ' ' + sizes[i];
}

/**
 * Get download URL from Migu item
 */
function getDownloadUrl(item) {
  // Use listenUrl if available
  if (item.listenUrl) return item.listenUrl;
  
  // Try mp3 URL
  if (item.mp3) return item.mp3;
  
  // Construct URL from copyrightId/contentId
  const copyrightId = item.copyrightId || item.id || item.contentId;
  const contentId = item.contentId || item.id || item.copyrightId;
  
  if (copyrightId && contentId) {
    return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?toneFlag=HQ&netType=00&userId=&ua=Android_migu&version=5.0.1&copyrightId=${copyrightId}&contentId=${contentId}&resourceType=2&channel=0`;
  }
  
  // Fallback
  return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?copyrightId=${copyrightId}&contentId=${contentId}`;
}

/**
 * Get format and file size from Migu item
 * Extracts readable format string and file size from rawFormat data
 */
function getFormatAndSize(item, rawFormat) {
  let format = 'MP3';
  let fileSize = 'Unknown';
  
  // If rawFormat is an array, process each format entry
  if (Array.isArray(rawFormat)) {
    // Get the highest quality format
    const bestFormat = rawFormat[rawFormat.length - 1] || rawFormat[0];
    
    if (bestFormat && typeof bestFormat === 'object') {
      // Extract format type
      const formatType = bestFormat.formatType || bestFormat.androidFormatId || bestFormat.iosFormatId || '';
      const ext = bestFormat.ext || bestFormat.format || '';
      
      // Map format codes to readable names
      const formatMap = {
        'SQ': 'SQ flac',
        'HQ': 'HQ mp3',
        'PQ': 'PQ mp3',
        'LQ': 'LQ mp3'
      };
      
      format = formatMap[formatType] || (ext ? ext.toUpperCase() : 'MP3');
      
      // Extract file size if available
      if (bestFormat.size) {
        fileSize = formatFileSize(bestFormat.size);
      } else if (bestFormat.fileSize) {
        fileSize = formatFileSize(bestFormat.fileSize);
      }
    } else if (typeof bestFormat === 'string') {
      format = bestFormat.toUpperCase();
    }
  } else if (rawFormat && typeof rawFormat === 'object') {
    // Single format object
    const formatType = rawFormat.formatType || rawFormat.androidFormatId || rawFormat.iosFormatId || '';
    const ext = rawFormat.ext || rawFormat.format || '';
    
    const formatMap = {
      'SQ': 'SQ flac',
      'HQ': 'HQ mp3',
      'PQ': 'PQ mp3',
      'LQ': 'LQ mp3'
    };
    
    format = formatMap[formatType] || (ext ? ext.toUpperCase() : 'MP3');
    
    if (rawFormat.size) {
      fileSize = formatFileSize(rawFormat.size);
    } else if (rawFormat.fileSize) {
      fileSize = formatFileSize(rawFormat.fileSize);
    }
  } else if (typeof rawFormat === 'string') {
    format = rawFormat.toUpperCase();
  }
  
  // Check formatType field directly on item
  if (item.formatType) {
    const formatMap = {
      'SQ': 'SQ flac',
      'HQ': 'HQ mp3',
      'PQ': 'PQ mp3',
      'LQ': 'LQ mp3'
    };
    format = formatMap[item.formatType] || String(item.formatType);
  }
  
  // Try to get fileSize from item directly if not found in rawFormat
  if (fileSize === 'Unknown' && item.fileSize) {
    fileSize = formatFileSize(item.fileSize);
  }
  
  return { format, fileSize };
}

/**
 * Get format from Migu item - always returns a string
 * @deprecated Use getFormatAndSize instead
 */
function getFormat(item) {
  // Check formatType field
  if (item.formatType) {
    // Map format codes to names
    const formatMap = {
      'SQ': 'FLAC',
      'HQ': 'MP3 320K',
      'PQ': 'MP3 128K'
    };
    return formatMap[item.formatType] || String(item.formatType);
  }
  
  // Check rateFormats
  if (item.rateFormats) {
    const formats = Array.isArray(item.rateFormats) ? item.rateFormats : String(item.rateFormats).split(',');
    const bestFormat = formats[formats.length - 1];
    return String(bestFormat || 'MP3');
  }
  
  // Check explicit format field - ensure it's always a string
  if (item.format) {
    // If format is an object, try to extract meaningful string
    if (typeof item.format === 'object' && item.format !== null) {
      // Try common properties for format objects
      return String(item.format.ext || item.format.type || item.format.formatText || 'MP3');
    }
    return String(item.format);
  }
  
  return 'MP3';
}
