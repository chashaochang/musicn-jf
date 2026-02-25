import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config.js';

let db = null;

/**
 * Initialize database connection and create tables
 */
export function initDatabase() {
  // Ensure config directory exists
  const configDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  db = new Database(config.DB_PATH);
  
  // Create tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      cover_url TEXT,
      download_url TEXT,
      file_size TEXT,
      format TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      staging_path TEXT,
      library_path TEXT,
      source_url TEXT,
      resolved_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  
  // Add source_url and resolved_url columns if they don't exist (migration)
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN source_url TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN resolved_url TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Add progress tracking columns if they don't exist (migration)
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN progress INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN downloaded_bytes INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN total_bytes INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN speed_bps INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN eta_seconds INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Add quality selection columns (migration)
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN preferred_tone_flag TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN allow_degrade INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN degrade_order TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN tried_tone_flags TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Add Migu-specific resolution fields (migration)
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN copyright_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN content_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN raw_format TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  
  return db;
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    initDatabase();
  }
  return db;
}

/**
 * Create a new download task
 */
export function createTask(taskData) {
  const db = getDatabase();
  const now = Date.now();
  
  // Validate required fields
  if (!taskData.service) {
    throw new Error('Missing required field: service');
  }
  if (!taskData.title) {
    throw new Error('Missing required field: title');
  }
  if (!taskData.artist) {
    throw new Error('Missing required field: artist');
  }
  
  // For non-migu services, downloadUrl is required
  // For migu service, either downloadUrl or copyrightId must be provided
  if (!taskData.downloadUrl || taskData.downloadUrl === '') {
    if (taskData.service === 'migu') {
      // Migu service can have empty downloadUrl if copyrightId is provided
      if (!taskData.copyrightId) {
        throw new Error('Missing required field: downloadUrl or copyrightId (for migu service)');
      }
    } else {
      // Non-migu services require downloadUrl
      throw new Error('Missing required field: downloadUrl');
    }
  }
  
  // Prepare degrade order - default to HQ->PQ->LQ if not specified
  const degradeOrder = taskData.degradeOrder 
    ? JSON.stringify(taskData.degradeOrder)
    : JSON.stringify(['HQ', 'PQ', 'LQ']);
  
  // Prepare raw format if it's an object
  const rawFormat = taskData.rawFormat 
    ? (typeof taskData.rawFormat === 'string' ? taskData.rawFormat : JSON.stringify(taskData.rawFormat))
    : null;
  
  const stmt = db.prepare(`
    INSERT INTO tasks (
      service, title, artist, album, cover_url, download_url,
      file_size, format, status, 
      preferred_tone_flag, allow_degrade, degrade_order,
      copyright_id, content_id, raw_format,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  try {
    const result = stmt.run(
      taskData.service,
      taskData.title,
      taskData.artist,
      taskData.album,
      taskData.coverUrl,
      taskData.downloadUrl,
      taskData.fileSize,
      taskData.format,
      taskData.preferredToneFlag || 'HQ',
      taskData.allowDegrade ? 1 : 0,
      degradeOrder,
      taskData.copyrightId || null,
      taskData.contentId || null,
      rawFormat,
      now,
      now
    );
    
    return result.lastInsertRowid;
  } catch (error) {
    console.error('Database insert error:', error);
    console.error('Task data:', taskData);
    throw new Error(`Database error: ${error.message}`);
  }
}

/**
 * Get all tasks
 */
export function getAllTasks() {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
  return stmt.all();
}

/**
 * Get task by ID
 */
export function getTaskById(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  return stmt.get(id);
}

/**
 * Update task status
 */
export function updateTaskStatus(id, status, errorMessage = null, additionalData = {}) {
  const db = getDatabase();
  const now = Date.now();
  
  let sql = 'UPDATE tasks SET status = ?, updated_at = ?';
  const params = [status, now];
  
  if (errorMessage) {
    sql += ', error_message = ?';
    params.push(errorMessage);
  }
  
  if (additionalData.stagingPath) {
    sql += ', staging_path = ?';
    params.push(additionalData.stagingPath);
  }
  
  if (additionalData.libraryPath) {
    sql += ', library_path = ?';
    params.push(additionalData.libraryPath);
  }
  
  if (additionalData.sourceUrl) {
    sql += ', source_url = ?';
    params.push(additionalData.sourceUrl);
  }
  
  if (additionalData.resolvedUrl) {
    sql += ', resolved_url = ?';
    params.push(additionalData.resolvedUrl);
  }
  
  if (additionalData.progress !== undefined) {
    sql += ', progress = ?';
    params.push(additionalData.progress);
  }
  
  if (additionalData.downloadedBytes !== undefined) {
    sql += ', downloaded_bytes = ?';
    params.push(additionalData.downloadedBytes);
  }
  
  if (additionalData.totalBytes !== undefined) {
    sql += ', total_bytes = ?';
    params.push(additionalData.totalBytes);
  }
  
  if (additionalData.speedBps !== undefined) {
    sql += ', speed_bps = ?';
    params.push(additionalData.speedBps);
  }
  
  if (additionalData.etaSeconds !== undefined) {
    sql += ', eta_seconds = ?';
    params.push(additionalData.etaSeconds);
  }
  
  if (additionalData.triedToneFlags) {
    sql += ', tried_tone_flags = ?';
    params.push(additionalData.triedToneFlags);
  }
  
  sql += ' WHERE id = ?';
  params.push(id);
  
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * Get next queued task
 */
export function getNextQueuedTask() {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 1');
  return stmt.get('queued');
}
