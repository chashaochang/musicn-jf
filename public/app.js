// DOM elements
const searchBtn = document.getElementById('searchBtn');
const searchText = document.getElementById('searchText');
const serviceSelect = document.getElementById('service');
const searchResults = document.getElementById('searchResults');
const tasksList = document.getElementById('tasksList');

// State
let polling = null;
let searchResultsData = []; // Store search results data separately

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
    
    displaySearchResults(data.results);
    
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
        <button class="download-btn" data-index="${index}" onclick="downloadSongByIndex(${index})">
          Download
        </button>
      </div>
    </div>
  `).join('');
}

// Download song by index
async function downloadSongByIndex(index) {
  const item = searchResultsData[index];
  if (!item) {
    alert('Invalid item selected');
    return;
  }
  
  await downloadSong(item);
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
    
    alert(`Download task created: ${item.title}`);
    loadTasks();
    
  } catch (error) {
    alert('Failed to create download task: ' + error.message);
  }
}

// Load tasks
async function loadTasks() {
  try {
    const response = await fetch('/api/tasks');
    const tasks = await response.json();
    
    if (tasks.error) {
      throw new Error(tasks.error);
    }
    
    displayTasks(tasks);
    
    // Optimize polling: only continue if there are active tasks
    const hasActiveTasks = tasks.some(task => 
      ['queued', 'downloading', 'organizing'].includes(task.status)
    );
    
    if (!hasActiveTasks && polling) {
      // No active tasks, slow down polling
      stopPolling();
      startPolling(10000); // Poll every 10 seconds instead
    } else if (hasActiveTasks && polling) {
      // Ensure we're polling at fast rate
      stopPolling();
      startPolling(3000);
    }
    
  } catch (error) {
    console.error('Failed to load tasks:', error);
  }
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
        src="${task.cover_url || '/placeholder.png'}" 
        alt="${task.title}"
        class="task-cover"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2224%22%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E'"
      >
      <div class="task-info">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-artist">${escapeHtml(task.artist)}</div>
        <div class="task-meta">
          ${task.album ? escapeHtml(task.album) + ' · ' : ''}
          ${task.format}
          ${task.library_path ? ' · ' + escapeHtml(task.library_path) : ''}
        </div>
        ${task.error_message ? `<div class="error-message">${escapeHtml(task.error_message)}</div>` : ''}
      </div>
      <div class="task-status status-${task.status}">
        ${task.status}
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

// Event listeners
searchBtn.addEventListener('click', searchMusic);
searchText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    searchMusic();
  }
});

// Start polling for tasks
function startPolling(interval = 3000) {
  loadTasks();
  polling = setInterval(loadTasks, interval);
}

// Stop polling
function stopPolling() {
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
}

// Initialize
startPolling();

// Clean up on page unload
window.addEventListener('beforeunload', stopPolling);
