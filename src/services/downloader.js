import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import got from 'got';
import config from '../config.js';
import { getExtension, createLibraryPath } from '../utils/fileUtils.js';
import { updateTaskStatus, getTaskById } from '../db/database.js';

/**
 * Download a file from URL to staging directory
 */
async function downloadToStaging(url, taskId, artist, title) {
  // Ensure staging directory exists
  if (!fs.existsSync(config.STAGING_DIR)) {
    fs.mkdirSync(config.STAGING_DIR, { recursive: true });
  }
  
  const ext = getExtension(url);
  const stagingFilename = `task_${taskId}_${Date.now()}${ext}`;
  const stagingPath = path.join(config.STAGING_DIR, stagingFilename);
  
  try {
    // Stream download
    await pipeline(
      got.stream(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: { request: 60000 }
      }),
      fs.createWriteStream(stagingPath)
    );
    
    return { stagingPath, ext };
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
 */
async function organizeToLibrary(stagingPath, artist, title, ext) {
  const { dir, filename } = createLibraryPath(artist, title, ext);
  const fullDir = path.join(config.LIBRARY_DIR, dir);
  const libraryPath = path.join(fullDir, filename);
  
  // Ensure library directory exists
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }
  
  // Move file from staging to library
  fs.renameSync(stagingPath, libraryPath);
  
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
    
    // Download file
    const { stagingPath, ext } = await downloadToStaging(
      task.download_url,
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
  // Import here to avoid circular dependency
  import('../db/database.js').then(({ getNextQueuedTask }) => {
    setInterval(async () => {
      const task = getNextQueuedTask();
      if (task) {
        await processDownloadTask(task.id);
      }
    }, 2000); // Check every 2 seconds
  });
}
