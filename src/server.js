import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { initDatabase, createTask, getAllTasks, getTaskById } from './db/database.js';
import { searchMigu } from './services/migu.js';
import { startDownloadQueue } from './services/downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize database
initDatabase();

// Start download queue processor
startDownloadQueue();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    config: {
      port: config.PORT,
      defaultService: config.DEFAULT_SERVICE
    }
  });
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { service = 'migu', text, pageNum = 1, pageSize = 20 } = req.query;
    
    if (!text) {
      return res.status(400).json({ error: 'Missing required parameter: text' });
    }
    
    let results = [];
    
    if (service === 'migu') {
      results = await searchMigu(text, parseInt(pageNum), parseInt(pageSize));
    } else {
      return res.status(400).json({ error: 'Unsupported service: ' + service });
    }
    
    res.json({
      service,
      query: text,
      pageNum: parseInt(pageNum),
      pageSize: parseInt(pageSize),
      results
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create download task
app.post('/api/tasks', (req, res) => {
  try {
    const taskData = req.body;
    
    if (!taskData.downloadUrl) {
      return res.status(400).json({ error: 'Missing required field: downloadUrl' });
    }
    
    const taskId = createTask({
      service: taskData.service || 'migu',
      title: taskData.title || 'Unknown',
      artist: taskData.artist || 'Unknown Artist',
      album: taskData.album || '',
      coverUrl: taskData.coverUrl || '',
      downloadUrl: taskData.downloadUrl,
      fileSize: taskData.fileSize || '',
      format: taskData.format || 'MP3'
    });
    
    const task = getTaskById(taskId);
    
    res.status(201).json(task);
    
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all tasks
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = getAllTasks();
    res.json(tasks);
  } catch (error) {
    console.error('List tasks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific task
app.get('/api/tasks/:id', (req, res) => {
  try {
    const task = getTaskById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(task);
    
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Config directory: ${config.CONFIG_DIR}`);
  console.log(`Staging directory: ${config.STAGING_DIR}`);
  console.log(`Library directory: ${config.LIBRARY_DIR}`);
});
