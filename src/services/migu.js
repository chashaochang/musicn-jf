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
    
    return songs.map(item => {
      const rawFormat = item.format || item.formatType || item.rateFormats;
      return {
        id: item.id || item.contentId || item.copyrightId,
        title: item.name || item.songName || 'Unknown',
        artist: item.singers?.map(s => s.name).join(', ') || item.singer || 'Unknown Artist',
        album: item.albums?.[0]?.name || item.albumName || '',
        coverUrl: normalizeCoverUrl(item.cover || item.albumImgs || item.largePic),
        downloadUrl: getDownloadUrl(item),
        fileSize: formatFileSize(item.fileSize),
        format: getFormat(item),
        // Keep raw format data for reference (optional)
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
function formatFileSize(size) {
  if (!size || size === 0) return 'Unknown';
  
  // If already formatted as string, return as is
  if (typeof size === 'string') return size;
  
  // Convert bytes to MB
  const mb = size / (1024 * 1024);
  return mb.toFixed(2) + ' MB';
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
 * Get format from Migu item - always returns a string
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
