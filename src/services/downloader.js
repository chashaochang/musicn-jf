import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import got from 'got';
import config from '../config.js';
import { getExtension, createLibraryPath } from '../utils/fileUtils.js';
import { updateTaskStatus, getTaskById, getNextQueuedTask } from '../db/database.js';

// Track if a download is currently in progress
let isProcessing = false;

/**
 * Map quality label (SQ/HQ/PQ/LQ) to actual Migu format code from rawFormat
 * @param {string} qualityLabel - Quality label (SQ, HQ, PQ, LQ)
 * @param {string|object|array} rawFormat - The rawFormat data from search results
 * @returns {string|null} - The actual format code (e.g., "020010" for HQ) or null if not found
 */
function mapQualityToFormatCode(qualityLabel, rawFormat) {
  if (!rawFormat) {
    return null;
  }
  
  // Parse rawFormat if it's a JSON string
  let formatData = rawFormat;
  if (typeof rawFormat === 'string') {
    try {
      formatData = JSON.parse(rawFormat);
    } catch (e) {
      // Not JSON, might be a simple string format label
      return null;
    }
  }
  
  // If rawFormat is an array, find the matching quality entry
  if (Array.isArray(formatData)) {
    const entry = formatData.find(item => 
      item && item.formatType === qualityLabel
    );
    
    if (entry) {
      // Priority: androidFormat > iosFormat > format
      const formatCode = entry.androidFormat || entry.iosFormat || entry.format;
      if (formatCode) {
        return String(formatCode);
      }
    }
  } 
  // If rawFormat is a single object, check if it matches the quality
  else if (typeof formatData === 'object' && formatData !== null) {
    if (formatData.formatType === qualityLabel) {
      const formatCode = formatData.androidFormat || formatData.iosFormat || formatData.format;
      if (formatCode) {
        return String(formatCode);
      }
    }
  }
  
  return null;
}

/**
 * Map quality label to format code with degradation fallback
 * Tries to find format code for the requested quality, or falls back to available qualities
 * @param {string} qualityLabel - Preferred quality label (SQ, HQ, PQ, LQ)
 * @param {string|object|array} rawFormat - The rawFormat data from search results
 * @param {string[]} degradeOrder - Order of qualities to try if preferred not available
 * @returns {{formatCode: string|null, actualQuality: string|null, mappingLog: string[]}}
 */
function mapQualityWithFallback(qualityLabel, rawFormat, degradeOrder = ['HQ', 'PQ', 'LQ']) {
  const mappingLog = [];
  
  // Try preferred quality first
  const preferredCode = mapQualityToFormatCode(qualityLabel, rawFormat);
  if (preferredCode) {
    mappingLog.push(`${qualityLabel} → ${preferredCode} (preferred)`);
    return { 
      formatCode: preferredCode, 
      actualQuality: qualityLabel,
      mappingLog 
    };
  }
  
  mappingLog.push(`${qualityLabel} → not found in rawFormat`);
  
  // Try degradation order
  for (const quality of degradeOrder) {
    if (quality === qualityLabel) {
      continue; // Already tried
    }
    
    const code = mapQualityToFormatCode(quality, rawFormat);
    if (code) {
      mappingLog.push(`${quality} → ${code} (degraded)`);
      return {
        formatCode: code,
        actualQuality: quality,
        mappingLog
      };
    }
    mappingLog.push(`${quality} → not found`);
  }
  
  return {
    formatCode: null,
    actualQuality: null,
    mappingLog
  };
}

/**
 * Resolve Migu download URL using copyrightId and toneFlag
 * Tries multiple APIs and fields to find a working download URL
 * @param {string} copyrightId - The Migu copyright ID
 * @param {string} contentId - The Migu content ID (optional)
 * @param {string} toneFlag - Quality flag (HQ, PQ, LQ, SQ) - will be mapped to format code
 * @param {string|object|array} rawFormat - The rawFormat data for mapping toneFlag to format code
 * @returns {Promise<{finalUrl: string, contentType?: string, error?: object}>}
 */
async function resolveMiguUrl(copyrightId, contentId, toneFlag = 'HQ', rawFormat = null) {
  if (!copyrightId) {
    return {
      finalUrl: null,
      error: {
        message: 'Missing copyrightId - cannot resolve Migu URL',
        code: 'MISSING_COPYRIGHT_ID'
      }
    };
  }
  
  console.log(`Resolving Migu URL: copyrightId=${copyrightId}, contentId=${contentId}, toneFlag=${toneFlag}`);
  
  const errors = [];
  let mappingLog = [];
  
  // Map quality label to actual format code
  let actualToneFlag = toneFlag; // Default to the quality label if mapping fails
  if (rawFormat) {
    const mapping = mapQualityWithFallback(toneFlag, rawFormat, []);
    mappingLog = mapping.mappingLog;
    
    if (mapping.formatCode) {
      actualToneFlag = mapping.formatCode;
      console.log(`Mapped ${toneFlag} to format code: ${actualToneFlag}`);
    } else {
      console.warn(`Failed to map ${toneFlag} to format code from rawFormat. Mapping attempts:`, mappingLog);
      // Continue with quality label as fallback, but log this issue
      errors.push({
        api: 'toneFlag_mapping',
        message: `rawFormat does not contain format code for ${toneFlag}`,
        mappingLog: mappingLog,
        note: 'Using quality label as fallback - may cause PE parameter error'
      });
    }
  } else {
    console.warn(`No rawFormat provided - cannot map ${toneFlag} to format code`);
    errors.push({
      api: 'toneFlag_mapping',
      message: 'rawFormat missing - cannot map quality to format code',
      note: 'Using quality label as fallback - may cause PE parameter error'
    });
  }
  
  // Strategy 1: Try listenSong.do API (most reliable for direct audio URLs)
  // Use contentId if available, otherwise fallback to copyrightId
  const effectiveContentId = contentId || copyrightId;
  if (effectiveContentId) {
    try {
      const listenUrl = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?toneFlag=${actualToneFlag}&netType=00&userId=&ua=Android_migu&version=5.0.1&copyrightId=${copyrightId}&contentId=${effectiveContentId}&resourceType=2&channel=0`;
      console.log(`Trying listenSong.do with toneFlag=${actualToneFlag}: ${listenUrl}`);
      
      const result = await resolveDownloadUrl(listenUrl, actualToneFlag);
      if (result.finalUrl) {
        console.log(`Successfully resolved via listenSong.do: ${result.finalUrl}`);
        return result;
      }
      if (result.error) {
        errors.push({
          api: 'listenSong.do',
          mappedToneFlag: `${toneFlag} → ${actualToneFlag}`,
          ...result.error
        });
      }
    } catch (error) {
      errors.push({
        api: 'listenSong.do',
        mappedToneFlag: `${toneFlag} → ${actualToneFlag}`,
        message: error.message
      });
    }
  }
  
  // Strategy 2: Try resourceinfo.do with different resourceType values
  // Note: resourceType=E is not supported by the API, only trying 2 and 0
  const resourceTypes = [2, 0]; // Try music (2) and general (0)
  
  for (const resourceType of resourceTypes) {
    try {
      const resourceUrl = `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${copyrightId}&resourceType=${resourceType}`;
      console.log(`Trying resourceinfo.do with resourceType=${resourceType}: ${resourceUrl}`);
      
      const response = await got.get(resourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://music.migu.cn/'
        },
        timeout: { request: 10000 },
        responseType: 'json',
        throwHttpErrors: false
      });
      
      const data = response.body;
      
      if (data.code !== '000000') {
        errors.push({
          api: `resourceinfo.do?resourceType=${resourceType}`,
          code: data.code,
          message: data.info || 'Unknown error'
        });
        continue;
      }
      
      // Look for URL in various fields
      if (data.resource && Array.isArray(data.resource) && data.resource.length > 0) {
        const resource = data.resource[0];
        const possibleUrlFields = ['audioUrl', 'url', 'playUrl', 'listenUrl', 'downloadUrl'];
        
        for (const field of possibleUrlFields) {
          if (resource[field]) {
            const audioUrl = resource[field];
            console.log(`Found ${field} in resourceinfo.do: ${audioUrl}`);
            
            // Try to construct direct URL
            try {
              const { pathname } = new URL(audioUrl);
              const directUrl = `https://freetyst.nf.migu.cn${pathname}`;
              
              // Verify the URL is accessible
              const headResponse = await got.head(directUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Referer': 'https://music.migu.cn/'
                },
                timeout: { request: 5000 },
                throwHttpErrors: false
              });
              
              if (headResponse.statusCode === 200) {
                console.log(`Successfully resolved via resourceinfo.do: ${directUrl}`);
                return {
                  finalUrl: directUrl,
                  contentType: headResponse.headers['content-type']
                };
              }
            } catch (urlError) {
              console.error(`Failed to parse or verify URL from ${field}:`, urlError.message);
            }
          }
        }
        
        errors.push({
          api: `resourceinfo.do?resourceType=${resourceType}`,
          message: `Response successful but no valid URL found in fields: ${possibleUrlFields.join(', ')}`,
          availableFields: Object.keys(resource)
        });
      } else {
        errors.push({
          api: `resourceinfo.do?resourceType=${resourceType}`,
          message: 'Response successful but no resource array found',
          responseKeys: Object.keys(data)
        });
      }
    } catch (error) {
      errors.push({
        api: `resourceinfo.do?resourceType=${resourceType}`,
        message: error.message
      });
    }
  }
  
  // All strategies failed
  return {
    finalUrl: null,
    error: {
      message: `Failed to resolve Migu URL after trying all strategies`,
      toneFlag: toneFlag,
      mappedToneFlag: actualToneFlag,
      mappingLog: mappingLog.length > 0 ? mappingLog : undefined,
      copyrightId: copyrightId,
      contentId: contentId,
      attempts: errors
    }
  };
}

/**
 * Resolve URL by following redirects or parsing JSON responses
 * @param {string} url - The initial URL (e.g., listenSong.do)
 * @param {string} toneFlag - The quality flag (HQ, PQ, LQ, SQ)
 * @returns {Promise<{finalUrl: string, contentType?: string, error?: object}>}
 */
async function resolveDownloadUrl(url, toneFlag = 'HQ') {
  try {
    // Update URL with toneFlag if it's a listenSong.do URL
    let resolveUrl = url;
    if (url.includes('listenSong.do')) {
      // Replace or add toneFlag parameter
      const urlObj = new URL(url);
      urlObj.searchParams.set('toneFlag', toneFlag);
      resolveUrl = urlObj.toString();
    }
    
    console.log(`Resolving URL with toneFlag=${toneFlag}: ${resolveUrl}`);
    
    // Make a HEAD request first to check for redirects
    const response = await got.head(resolveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.migu.cn/'
      },
      followRedirect: false, // Don't auto-follow, we want to inspect the redirect
      throwHttpErrors: false,
      timeout: { request: 10000 }
    });
    
    // Check for redirect responses (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      if (location) {
        console.log(`URL resolved via ${response.statusCode} redirect: ${location}`);
        return {
          finalUrl: location,
          contentType: null
        };
      }
    }
    
    // Handle error status codes (4xx, 5xx)
    if (response.statusCode >= 400) {
      const contentType = response.headers['content-type'] || '';
      
      // If it's JSON, fetch the body to get error details
      if (contentType.includes('application/json')) {
        try {
          const errorResponse = await got.get(resolveUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://music.migu.cn/'
            },
            timeout: { request: 10000 },
            responseType: 'json',
            throwHttpErrors: false
          });
          
          const errorData = errorResponse.body;
          const errorMsg = errorData?.message || errorData?.msg || errorData?.info || 'Unknown error';
          const errorCode = errorData?.code || errorData?.errorCode || response.statusCode;
          
          console.error(`API returned ${response.statusCode} with JSON error:`, errorData);
          
          return {
            finalUrl: null,
            error: {
              statusCode: response.statusCode,
              contentType: contentType,
              message: errorMsg,
              code: errorCode,
              toneFlag: toneFlag
            }
          };
        } catch (jsonError) {
          console.error(`Failed to parse JSON error response:`, jsonError);
        }
      }
      
      // Non-JSON error response
      throw new Error(`HTTP ${response.statusCode} ${contentType ? `(${contentType})` : ''} for toneFlag=${toneFlag}`);
    }
    
    // If HEAD request succeeds (200), check content type
    if (response.statusCode === 200) {
      const contentType = response.headers['content-type'];
      
      // If it's JSON, fetch and parse it for the real URL
      if (contentType && contentType.includes('application/json')) {
        const jsonResponse = await got.get(resolveUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://music.migu.cn/'
          },
          timeout: { request: 10000 },
          responseType: 'json'
        });
        
        // Try common JSON fields for download URLs
        const data = jsonResponse.body;
        const possibleUrlFields = ['url', 'playUrl', 'downloadUrl', 'mp3Url', 'listenUrl'];
        
        for (const field of possibleUrlFields) {
          if (data[field]) {
            console.log(`URL resolved from JSON field '${field}': ${data[field]}`);
            return {
              finalUrl: data[field],
              contentType: null
            };
          }
        }
        
        throw new Error('JSON response does not contain a recognizable download URL field');
      }
      
      // If it's a direct audio file, use the original URL
      if (contentType && (contentType.includes('audio/') || contentType.includes('application/octet-stream'))) {
        console.log(`URL is direct audio file: ${resolveUrl}`);
        return {
          finalUrl: resolveUrl,
          contentType: contentType
        };
      }
    }
    
    // Fallback: if no redirect or JSON, try GET request to see if it redirects
    const getResponse = await got.get(resolveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.migu.cn/'
      },
      followRedirect: false,
      throwHttpErrors: false,
      timeout: { request: 10000 }
    });
    
    if ([301, 302, 303, 307, 308].includes(getResponse.statusCode)) {
      const location = getResponse.headers.location;
      if (location) {
        console.log(`URL resolved via GET ${getResponse.statusCode} redirect: ${location}`);
        return {
          finalUrl: location,
          contentType: null
        };
      }
    }
    
    throw new Error(`Unable to resolve final download URL. Status: ${response.statusCode}, Content-Type: ${response.headers['content-type']}`);
    
  } catch (error) {
    if (error.message.includes('Unable to resolve')) {
      throw error;
    }
    throw new Error(`Failed to resolve download URL: ${error.message}`);
  }
}

/**
 * Infer file extension from URL, Content-Type, or Content-Disposition
 * @param {string} url - The download URL
 * @param {object} headers - Response headers (optional)
 * @returns {string} - File extension (e.g., '.mp3', '.flac')
 */
function inferExtension(url, headers = {}) {
  // First try to get extension from URL
  const urlExt = getExtension(url, null);
  if (urlExt && urlExt !== '.do') {
    return urlExt;
  }
  
  // Check Content-Disposition header for filename
  const disposition = headers['content-disposition'];
  if (disposition) {
    const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch && filenameMatch[1]) {
      const filename = filenameMatch[1].replace(/['"]/g, '');
      const ext = getExtension(filename, null);
      if (ext && ext !== '.do') {
        return ext;
      }
    }
  }
  
  // Check Content-Type header
  const contentType = headers['content-type'];
  if (contentType) {
    const typeMap = {
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/flac': '.flac',
      'audio/x-flac': '.flac',
      'audio/mp4': '.m4a',
      'audio/m4a': '.m4a',
      'audio/x-m4a': '.m4a'
    };
    
    for (const [type, ext] of Object.entries(typeMap)) {
      if (contentType.includes(type)) {
        return ext;
      }
    }
  }
  
  // Default to .mp3
  return '.mp3';
}

/**
 * Download a file from URL to staging directory
 */
async function downloadToStaging(url, taskId, artist, title) {
  // Ensure staging directory exists
  if (!fs.existsSync(config.STAGING_DIR)) {
    fs.mkdirSync(config.STAGING_DIR, { recursive: true });
  }
  
  // We'll determine extension after starting the download
  const stagingFilename = `task_${taskId}_${Date.now()}.tmp`;
  const stagingPath = path.join(config.STAGING_DIR, stagingFilename);
  
  try {
    let detectedExt = '.mp3'; // Default
    let totalBytes = 0;
    let downloadedBytes = 0;
    let startTime = Date.now();
    let lastUpdateTime = startTime;
    
    // Stream download
    const downloadStream = got.stream(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.migu.cn/'
      },
      timeout: { request: 60000 }
    });
    
    // Get headers from the response to infer extension
    downloadStream.on('response', (response) => {
      detectedExt = inferExtension(url, response.headers);
      console.log(`Detected extension: ${detectedExt} for URL: ${url}`);
      
      // Get total size from Content-Length header
      const contentLength = response.headers['content-length'];
      if (contentLength) {
        totalBytes = parseInt(contentLength, 10);
        console.log(`Total file size: ${totalBytes} bytes`);
        updateTaskStatus(taskId, 'downloading', null, {
          totalBytes,
          downloadedBytes: 0,
          progress: 0
        });
      }
    });
    
    // Track download progress
    downloadStream.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const now = Date.now();
      
      // Update progress every 500ms to avoid too frequent database writes
      if (now - lastUpdateTime >= 500) {
        lastUpdateTime = now;
        
        const elapsedSeconds = (now - startTime) / 1000;
        const speedBps = elapsedSeconds > 0 ? Math.floor(downloadedBytes / elapsedSeconds) : 0;
        
        let progress = 0;
        let etaSeconds = 0;
        
        if (totalBytes > 0) {
          progress = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
          const remainingBytes = totalBytes - downloadedBytes;
          etaSeconds = speedBps > 0 ? Math.floor(remainingBytes / speedBps) : 0;
        }
        
        updateTaskStatus(taskId, 'downloading', null, {
          downloadedBytes,
          totalBytes,
          progress,
          speedBps,
          etaSeconds
        });
      }
    });
    
    const writeStream = fs.createWriteStream(stagingPath);
    
    await pipeline(
      downloadStream,
      writeStream
    );
    
    // Final progress update
    if (totalBytes > 0) {
      updateTaskStatus(taskId, 'downloading', null, {
        downloadedBytes: totalBytes,
        totalBytes,
        progress: 100,
        speedBps: 0,
        etaSeconds: 0
      });
    }
    
    // Rename file with correct extension
    const finalStagingPath = stagingPath.replace('.tmp', detectedExt);
    fs.renameSync(stagingPath, finalStagingPath);
    
    return { stagingPath: finalStagingPath, ext: detectedExt };
  } catch (error) {
    // Clean up partial file
    if (fs.existsSync(stagingPath)) {
      fs.unlinkSync(stagingPath);
    }
    throw error;
  }
}

/**
 * Organize file from staging to library
 * Uses copy + delete for cross-filesystem compatibility
 */
async function organizeToLibrary(stagingPath, artist, title, ext) {
  const { dir, filename } = createLibraryPath(artist, title, ext);
  const fullDir = path.join(config.LIBRARY_DIR, dir);
  const libraryPath = path.join(fullDir, filename);
  
  // Ensure library directory exists
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }
  
  // Copy file from staging to library (handles cross-filesystem moves)
  fs.copyFileSync(stagingPath, libraryPath);
  
  // Delete the staging file
  fs.unlinkSync(stagingPath);
  
  return libraryPath;
}

/**
 * Process a download task
 */
export async function processDownloadTask(taskId) {
  const task = getTaskById(taskId);
  
  if (!task) {
    console.error(`Task ${taskId} not found`);
    return;
  }
  
  try {
    // Update status to downloading
    updateTaskStatus(taskId, 'downloading');
    
    // Parse degradation settings
    const preferredToneFlag = task.preferred_tone_flag || 'HQ';
    const allowDegrade = task.allow_degrade === 1;
    let degradeOrder = ['HQ', 'PQ', 'LQ']; // Default
    
    if (task.degrade_order) {
      try {
        degradeOrder = JSON.parse(task.degrade_order);
      } catch (e) {
        console.warn(`Failed to parse degrade_order, using default:`, e);
      }
    }
    
    console.log(`Processing task ${taskId}: service=${task.service}, preferredToneFlag=${preferredToneFlag}, allowDegrade=${allowDegrade}`);
    
    let resolveResult;
    const triedFlags = [preferredToneFlag];
    
    // Check if we need to resolve the URL for Migu
    if (task.service === 'migu' && (!task.download_url || task.download_url === '')) {
      // Migu service with empty downloadUrl - resolve using copyrightId
      console.log(`Migu task with empty downloadUrl, resolving using copyrightId=${task.copyright_id}`);
      
      // Parse rawFormat if it's a JSON string
      let rawFormat = task.raw_format;
      if (rawFormat && typeof rawFormat === 'string') {
        try {
          rawFormat = JSON.parse(rawFormat);
        } catch (e) {
          console.warn(`Failed to parse raw_format:`, e);
          rawFormat = null;
        }
      }
      
      // Try to resolve URL with preferred quality first
      resolveResult = await resolveMiguUrl(task.copyright_id, task.content_id, preferredToneFlag, rawFormat);
      
      // If preferred quality failed and degradation is allowed
      if (resolveResult.error && allowDegrade) {
        console.log(`Preferred quality ${preferredToneFlag} failed, attempting degradation...`);
        
        // Try each quality in degradeOrder
        for (const toneFlag of degradeOrder) {
          // Skip if already tried
          if (triedFlags.includes(toneFlag)) {
            continue;
          }
          
          triedFlags.push(toneFlag);
          console.log(`Trying degraded quality: ${toneFlag}`);
          
          resolveResult = await resolveMiguUrl(task.copyright_id, task.content_id, toneFlag, rawFormat);
          
          // If successful, break
          if (resolveResult.finalUrl) {
            console.log(`Successfully resolved with degraded quality: ${toneFlag}`);
            break;
          }
        }
      }
      
      // If still failed after all attempts
      if (resolveResult.error || !resolveResult.finalUrl) {
        const error = resolveResult.error || {};
        let errorMessage = `Failed to resolve Migu download URL after trying qualities: ${triedFlags.join(', ')}. `;
        
        // Add mapping information
        if (error.mappingLog && error.mappingLog.length > 0) {
          errorMessage += `Quality mapping: ${error.mappingLog.join(', ')}. `;
        }
        
        if (error.copyrightId) {
          errorMessage += `CopyrightId: ${error.copyrightId}. `;
        }
        if (error.contentId) {
          errorMessage += `ContentId: ${error.contentId}. `;
        }
        
        if (error.attempts && Array.isArray(error.attempts)) {
          const attemptMessages = error.attempts.map(a => {
            let msg = `${a.api}`;
            if (a.mappedToneFlag) {
              msg += ` (${a.mappedToneFlag})`;
            }
            if (a.statusCode) {
              msg += ` HTTP ${a.statusCode}`;
            }
            if (a.code) {
              msg += ` code=${a.code}`;
            }
            if (a.message) {
              msg += `: ${a.message}`;
            }
            if (a.mappingLog) {
              msg += ` [${a.mappingLog.join(', ')}]`;
            }
            return msg;
          });
          errorMessage += `Attempts: ${attemptMessages.join('; ')}`;
        } else if (error.message) {
          errorMessage += error.message;
        }
        
        // Store tried flags for debugging
        updateTaskStatus(taskId, 'failed', errorMessage, {
          triedToneFlags: triedFlags.join(',')
        });
        
        throw new Error(errorMessage);
      }
    } else if (task.download_url && task.download_url !== '') {
      // Has downloadUrl - try to resolve it (for redirects or JSON responses)
      console.log(`Resolving existing downloadUrl: ${task.download_url}`);
      
      // Parse rawFormat if it's a JSON string (for Migu listenSong.do URLs)
      let rawFormat = task.raw_format;
      if (rawFormat && typeof rawFormat === 'string') {
        try {
          rawFormat = JSON.parse(rawFormat);
        } catch (e) {
          console.warn(`Failed to parse raw_format:`, e);
          rawFormat = null;
        }
      }
      
      // For Migu listenSong.do URLs, map quality to format code
      let actualToneFlag = preferredToneFlag;
      if (task.service === 'migu' && task.download_url.includes('listenSong.do') && rawFormat) {
        const mapping = mapQualityWithFallback(preferredToneFlag, rawFormat, []);
        if (mapping.formatCode) {
          actualToneFlag = mapping.formatCode;
          console.log(`Mapped ${preferredToneFlag} to format code: ${actualToneFlag}`);
        }
      }
      
      resolveResult = await resolveDownloadUrl(task.download_url, actualToneFlag);
      
      // If preferred quality failed and degradation is allowed
      if (resolveResult.error && allowDegrade) {
        console.log(`Preferred quality ${preferredToneFlag} failed, attempting degradation...`);
        
        // Try each quality in degradeOrder
        for (const toneFlag of degradeOrder) {
          // Skip if already tried
          if (triedFlags.includes(toneFlag)) {
            continue;
          }
          
          triedFlags.push(toneFlag);
          console.log(`Trying degraded quality: ${toneFlag}`);
          
          // Map this quality to format code if applicable
          let degradedToneFlag = toneFlag;
          if (task.service === 'migu' && task.download_url.includes('listenSong.do') && rawFormat) {
            const mapping = mapQualityWithFallback(toneFlag, rawFormat, []);
            if (mapping.formatCode) {
              degradedToneFlag = mapping.formatCode;
              console.log(`Mapped ${toneFlag} to format code: ${degradedToneFlag}`);
            }
          }
          
          resolveResult = await resolveDownloadUrl(task.download_url, degradedToneFlag);
          
          // If successful, break
          if (resolveResult.finalUrl) {
            console.log(`Successfully resolved with degraded quality: ${toneFlag}`);
            break;
          }
        }
      }
      
      // If still failed after all attempts
      if (resolveResult.error || !resolveResult.finalUrl) {
        const error = resolveResult.error || {};
        let errorMessage = `Failed to resolve download URL after trying: ${triedFlags.join(', ')}. `;
        
        if (error.statusCode) {
          errorMessage += `Status: ${error.statusCode}`;
        }
        if (error.contentType) {
          errorMessage += `, Content-Type: ${error.contentType}`;
        }
        if (error.message) {
          errorMessage += `, Message: ${error.message}`;
        }
        if (error.code) {
          errorMessage += `, Code: ${error.code}`;
        }
        
        // Store tried flags for debugging
        updateTaskStatus(taskId, 'failed', errorMessage, {
          triedToneFlags: triedFlags.join(',')
        });
        
        throw new Error(errorMessage);
      }
    } else {
      // No downloadUrl and not Migu service - error
      const errorMessage = 'Cannot download: missing downloadUrl and not a Migu task with copyrightId';
      updateTaskStatus(taskId, 'failed', errorMessage);
      throw new Error(errorMessage);
    }
    
    const finalUrl = resolveResult.finalUrl;
    console.log(`Resolved to: ${finalUrl}`);
    
    // Store both source and resolved URLs, and tried flags
    updateTaskStatus(taskId, 'downloading', null, {
      sourceUrl: task.download_url,
      resolvedUrl: finalUrl,
      triedToneFlags: triedFlags.join(',')
    });
    
    // Download file using resolved URL
    const { stagingPath, ext } = await downloadToStaging(
      finalUrl,
      taskId,
      task.artist,
      task.title
    );
    
    // Update with staging path
    updateTaskStatus(taskId, 'organizing', null, { stagingPath });
    
    // Organize to library
    const libraryPath = await organizeToLibrary(
      stagingPath,
      task.artist,
      task.title,
      ext
    );
    
    // Update status to done
    updateTaskStatus(taskId, 'done', null, { libraryPath });
    
    console.log(`Task ${taskId} completed: ${libraryPath}`);
    
  } catch (error) {
    console.error(`Task ${taskId} failed:`, error.message);
    updateTaskStatus(taskId, 'failed', error.message);
  }
}

/**
 * Start download queue processor
 */
export function startDownloadQueue() {
  setInterval(async () => {
    // Skip if already processing a task
    if (isProcessing) {
      return;
    }
    
    const task = getNextQueuedTask();
    if (task) {
      isProcessing = true;
      try {
        await processDownloadTask(task.id);
      } finally {
        isProcessing = false;
      }
    }
  }, 2000); // Check every 2 seconds
}
