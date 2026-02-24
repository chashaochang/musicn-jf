import got from 'got';

/**
 * Search music on Migu platform
 */
export async function searchMigu(text, pageNum = 1, pageSize = 20) {
  try {
    // Migu music search API (public interface)
    const url = 'https://m.music.migu.cn/migu/remoting/scr_search_tag';
    
    const searchParams = {
      keyword: text,
      type: 2, // 2 for songs
      pgc: pageNum,
      rows: pageSize
    };
    
    const response = await got.get(url, {
      searchParams,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://m.music.migu.cn/'
      },
      timeout: { request: 10000 }
    }).json();
    
    // Parse response
    if (!response || !response.musics) {
      return [];
    }
    
    return response.musics.map(item => ({
      id: item.id,
      title: item.songName || item.title || 'Unknown',
      artist: item.singerName || item.singer || 'Unknown Artist',
      album: item.albumName || item.album || '',
      coverUrl: item.cover || item.pic || '',
      downloadUrl: getDownloadUrl(item),
      fileSize: item.fileSize || 'Unknown',
      format: getFormat(item)
    }));
    
  } catch (error) {
    console.error('Migu search error:', error.message);
    throw new Error('Failed to search music: ' + error.message);
  }
}

/**
 * Get download URL from Migu item
 */
function getDownloadUrl(item) {
  // Try different URL fields
  if (item.mp3) return item.mp3;
  if (item.listenUrl) return item.listenUrl;
  if (item.lrcUrl) {
    // Construct mp3 URL from lrc URL pattern
    const copyrightId = item.copyrightId || item.id;
    if (copyrightId) {
      return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?toneFlag=HQ&netType=00&userId=&ua=Android_migu&version=5.0.1&copyrightId=${copyrightId}&contentId=${copyrightId}&resourceType=2&channel=0`;
    }
  }
  
  // Fallback: construct URL from copyrightId
  const copyrightId = item.copyrightId || item.id;
  return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?copyrightId=${copyrightId}&contentId=${copyrightId}`;
}

/**
 * Get format from Migu item
 */
function getFormat(item) {
  if (item.format) return item.format;
  if (item.rateFormats) {
    const formats = item.rateFormats.split(',');
    return formats[formats.length - 1] || 'MP3';
  }
  return 'MP3';
}
