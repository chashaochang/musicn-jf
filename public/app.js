// DOM elements
const searchBtn = document.getElementById('searchBtn');
const searchText = document.getElementById('searchText');
const serviceSelect = document.getElementById('service');
const searchResults = document.getElementById('searchResults');
const tasksList = document.getElementById('tasksList');
const queueBtn = document.getElementById('queueBtn');
const queueBadge = document.getElementById('queueBadge');
const queuePanel = document.getElementById('queuePanel');
const queuePanelOverlay = document.getElementById('queuePanelOverlay');
const closePanelBtn = document.getElementById('closePanelBtn');
const queuePanelContent = document.getElementById('queuePanelContent');

// State
let pollingTimeoutId = null; // Timeout ID for next scheduled poll
let isLoadingTasks = false; // Flag to prevent concurrent requests
let abortController = null; // AbortController for canceling in-flight requests
let searchResultsData = []; // Store search results data separately
let currentTasks = []; // Store current tasks for queue panel

// Search music
async function searchMusic() {
  const text = searchText.value.trim();
  const service = serviceSelect.value;
  
  if (!text) {
    alert('Please enter search text');
    return;
  }
  
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  searchResults.innerHTML = '<p class="loading">Searching...</p>';
  
  try {
    const response = await fetch(`/api/search?service=${service}&text=${encodeURIComponent(text)}&pageNum=1&pageSize=20`);
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    // Support both 'results' and 'items' fields for compatibility
    const results = data.results || data.items || [];
    displaySearchResults(results);
    
  } catch (error) {
    searchResults.innerHTML = `<p class="placeholder">Error: ${error.message}</p>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// Display search results
function displaySearchResults(results) {
  if (!results || results.length === 0) {
    searchResults.innerHTML = '<p class="placeholder">No results found</p>';
    searchResultsData = [];
    return;
  }
  
  // Store results data
  searchResultsData = results;
  
  searchResults.innerHTML = results.map((item, index) => `
    <div class="result-item">
      <img 
        src="${escapeHtml(item.coverUrl || '/placeholder.png')}" 
        alt="${escapeHtml(item.title)}"
        class="result-cover"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2224%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
      >
      <div class="result-info">
        <div class="result-title">${escapeHtml(item.title)}</div>
        <div class="result-artist">${escapeHtml(item.artist)}</div>
        <div class="result-meta">
          ${item.album ? escapeHtml(item.album) + ' · ' : ''}
          ${escapeHtml(item.format)} · ${escapeHtml(item.fileSize)}
        </div>
      </div>
      <div class="result-actions">
        <button class="download-btn" data-index="${index}" onclick="downloadSongByIndex(${index}, this)">
          Download
        </button>
      </div>
    </div>
  `).join('');
}

// Download song by index
async function downloadSongByIndex(index, buttonElement) {
  const item = searchResultsData[index];
  if (!item) {
    alert('Invalid item selected');
    return;
  }
  
  // Disable button immediately
  if (buttonElement) {
    buttonElement.disabled = true;
    buttonElement.textContent = 'Added ✓';
    buttonElement.style.background = '#28a745';
  }
  
  // Get the cover image element for animation
  const resultItem = buttonElement ? buttonElement.closest('.result-item') : null;
  const coverImg = resultItem ? resultItem.querySelector('.result-cover') : null;
  
  try {
    await downloadSong(item);
    
    // Trigger flying animation
    if (coverImg) {
      flyToQueue(coverImg);
    }
    
  } catch (error) {
    // Re-enable button on error
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.textContent = 'Download';
      buttonElement.style.background = '';
    }
    throw error;
  }
}

// Download song
async function downloadSong(item) {
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service: serviceSelect.value,
        title: item.title,
        artist: item.artist,
        album: item.album,
        coverUrl: item.coverUrl,
        downloadUrl: item.downloadUrl,
        fileSize: item.fileSize,
        format: item.format
      })
    });
    
    const task = await response.json();
    
    if (task.error) {
      throw new Error(task.error);
    }
    
    // Don't show alert, just update tasks quietly
    loadTasks();
    
  } catch (error) {
    alert('Failed to create download task: ' + error.message);
  }
}

// Load tasks
async function loadTasks() {
  // Prevent concurrent requests - only one request should be in-flight at a time
  if (isLoadingTasks) {
    console.log('loadTasks: Already loading, skipping...');
    return;
  }

  isLoadingTasks = true;

  // Cancel any previous in-flight request
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  try {
    const response = await fetch('/api/tasks', { 
      signal: abortController.signal 
    });
    const tasks = await response.json();
    
    if (tasks.error) {
      throw new Error(tasks.error);
    }
    
    displayTasks(tasks);
    
    // Store tasks for queue panel
    currentTasks = tasks;
    
    // Update queue badge
    const activeTasks = tasks.filter(task => 
      ['queued', 'downloading', 'organizing'].includes(task.status)
    );
    updateQueueBadge(activeTasks.length);
    
    // Update queue panel if it's open
    if (queuePanel.style.display !== 'none') {
      displayQueuePanel();
    }
    
    // Determine if there are active tasks
    const hasActiveTasks = activeTasks.length > 0;
    
    // Schedule next poll based on task activity
    // Active tasks: poll every 3 seconds for frequent updates
    // No active tasks: poll every 10 seconds for background monitoring
    const nextInterval = hasActiveTasks ? 3000 : 10000;
    scheduleNextPoll(nextInterval);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('loadTasks: Request aborted');
    } else {
      console.error('Failed to load tasks:', error);
      // On error, retry after 10 seconds
      scheduleNextPoll(10000);
    }
  } finally {
    isLoadingTasks = false;
  }
}

// Schedule the next poll after a delay
// This implements serial polling: only one request in-flight at a time
// Why not setInterval? setInterval fires at fixed intervals regardless of
// request completion time, leading to request pile-up if responses are slow.
// Using setTimeout after request completion ensures serial execution.
function scheduleNextPoll(delay) {
  // Clear any existing scheduled poll
  if (pollingTimeoutId) {
    clearTimeout(pollingTimeoutId);
    pollingTimeoutId = null;
  }
  
  // Schedule the next poll
  pollingTimeoutId = setTimeout(() => {
    loadTasks();
  }, delay);
}

// Display tasks
function displayTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    tasksList.innerHTML = '<p class="placeholder">No tasks yet</p>';
    return;
  }
  
  tasksList.innerHTML = tasks.map(task => `
    <div class="task-item">
      <img 
        src="${escapeHtml(task.cover_url || '/placeholder.png')}" 
        alt="${escapeHtml(task.title)}"
        class="task-cover"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2224%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
      >
      <div class="task-info">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-artist">${escapeHtml(task.artist)}</div>
        <div class="task-meta">
          ${task.album ? escapeHtml(task.album) + ' · ' : ''}
          ${escapeHtml(task.format)}
          ${task.library_path ? ' · ' + escapeHtml(task.library_path) : ''}
        </div>
        ${task.error_message ? `<div class="error-message">${escapeHtml(task.error_message)}</div>` : ''}
      </div>
      <div class="task-status status-${escapeHtml(task.status)}">
        ${escapeHtml(task.status)}
      </div>
    </div>
  `).join('');
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Update queue badge
function updateQueueBadge(count) {
  queueBadge.textContent = count;
  if (count > 0) {
    queueBadge.classList.remove('hidden');
  } else {
    queueBadge.classList.add('hidden');
  }
}

// Format bytes to human-readable string
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format speed
function formatSpeed(bps) {
  if (bps === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s'];
  const i = Math.floor(Math.log(bps) / Math.log(k));
  return Math.round(bps / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format ETA
function formatEta(seconds) {
  if (seconds === 0) return 'calculating...';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

// Display queue panel
function displayQueuePanel() {
  if (!currentTasks || currentTasks.length === 0) {
    queuePanelContent.innerHTML = '<p class="placeholder">No tasks in queue</p>';
    return;
  }
  
  queuePanelContent.innerHTML = currentTasks.map(task => {
    const isActive = ['queued', 'downloading', 'organizing'].includes(task.status);
    const progress = task.progress || 0;
    const hasProgress = task.total_bytes > 0;
    
    let progressHtml = '';
    if (task.status === 'downloading') {
      if (hasProgress) {
        progressHtml = `
          <div class="queue-task-progress">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-info">
              <span>${progress}% - ${formatBytes(task.downloaded_bytes || 0)} / ${formatBytes(task.total_bytes || 0)}</span>
              <span>${task.speed_bps ? formatSpeed(task.speed_bps) : ''} ${task.eta_seconds ? '· ETA ' + formatEta(task.eta_seconds) : ''}</span>
            </div>
          </div>
        `;
      } else {
        progressHtml = `
          <div class="queue-task-progress">
            <div class="progress-bar">
              <div class="progress-bar-indeterminate"></div>
            </div>
            <div class="progress-info">
              <span>Downloading... ${formatBytes(task.downloaded_bytes || 0)}</span>
            </div>
          </div>
        `;
      }
    }
    
    return `
      <div class="queue-task-item">
        <div class="queue-task-header">
          <img 
            src="${escapeHtml(task.cover_url || '/placeholder.png')}" 
            alt="${escapeHtml(task.title)}"
            class="queue-task-cover"
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22%3E%3Crect fill=%22%23ddd%22 width=%2250%22 height=%2250%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2220%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
          >
          <div class="queue-task-info">
            <div class="queue-task-title">${escapeHtml(task.title)}</div>
            <div class="queue-task-artist">${escapeHtml(task.artist)}</div>
          </div>
          <div class="queue-task-status status-${escapeHtml(task.status)}">
            ${escapeHtml(task.status)}
          </div>
        </div>
        ${progressHtml}
        ${task.error_message ? `<div class="queue-task-error">${escapeHtml(task.error_message)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Show queue panel
function showQueuePanel() {
  displayQueuePanel();
  queuePanel.style.display = 'flex';
  queuePanelOverlay.style.display = 'block';
}

// Hide queue panel
function hideQueuePanel() {
  queuePanel.style.display = 'none';
  queuePanelOverlay.style.display = 'none';
}

// Flying animation
function flyToQueue(coverElement) {
  if (!coverElement) return;
  
  const rect = coverElement.getBoundingClientRect();
  const queueRect = queueBtn.getBoundingClientRect();
  
  // Create flying element
  const flying = document.createElement('div');
  flying.className = 'flying-thumbnail';
  flying.style.left = rect.left + 'px';
  flying.style.top = rect.top + 'px';
  flying.style.width = rect.width + 'px';
  flying.style.height = rect.height + 'px';
  
  // Calculate translation distance
  const tx = queueRect.left + queueRect.width / 2 - rect.left - rect.width / 2;
  const ty = queueRect.top + queueRect.height / 2 - rect.top - rect.height / 2;
  
  flying.style.setProperty('--tx', tx + 'px');
  flying.style.setProperty('--ty', ty + 'px');
  
  document.body.appendChild(flying);
  
  // Remove after animation
  setTimeout(() => {
    flying.remove();
  }, 800);
}

// Event listeners
searchBtn.addEventListener('click', searchMusic);
searchText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    searchMusic();
  }
});

queueBtn.addEventListener('click', showQueuePanel);
closePanelBtn.addEventListener('click', hideQueuePanel);
queuePanelOverlay.addEventListener('click', hideQueuePanel);

// Start polling for tasks
function startPolling() {
  // Immediately load tasks and start the polling cycle
  loadTasks();
}

// Stop polling
function stopPolling() {
  // Cancel any scheduled poll
  if (pollingTimeoutId) {
    clearTimeout(pollingTimeoutId);
    pollingTimeoutId = null;
  }
  
  // Abort any in-flight request
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  
  // Reset loading flag
  isLoadingTasks = false;
}

// Initialize
startPolling();

// Clean up on page unload
window.addEventListener('beforeunload', stopPolling);
