# musicn-jf

Music Downloader with WebUI - Docker-ready MVP for Unraid deployment

## Features

- 🎵 WebUI for music search and download
- 🔍 Search from Migu Music platform
- 📥 Download management with task queue
- 📁 Automatic file organization (Singles mode)
- 🐳 Docker-ready with easy deployment
- 💾 SQLite-based task persistence

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm (for local development)
- Docker and Docker Compose (for containerized deployment)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/chashaochang/musicn-jf.git
cd musicn-jf
```

2. Install dependencies:
```bash
pnpm install
```

3. Create necessary directories:
```bash
mkdir -p config music/_staging music/Library
```

4. Start the server:
```bash
pnpm start
```

5. Open your browser and navigate to `http://localhost:17890`

### Docker Deployment

#### Using Docker Compose (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/chashaochang/musicn-jf.git
cd musicn-jf
```

2. Create local directories for volumes:
```bash
mkdir -p config music
```

3. Start the container:
```bash
docker-compose up -d
```

4. Access the WebUI at `http://localhost:17890`

#### Using Docker CLI

```bash
docker build -t musicn-jf .

docker run -d \
  --name musicn-jf \
  -p 17890:17890 \
  -v $(pwd)/config:/config \
  -v $(pwd)/music:/music \
  -e PORT=17890 \
  -e CONFIG_DIR=/config \
  -e STAGING_DIR=/music/_staging \
  -e LIBRARY_DIR=/music/Library \
  -e DEFAULT_SERVICE=migu \
  musicn-jf
```

## Unraid Deployment

### Method 1: Using Docker Compose

1. Install the "Compose Manager" plugin from Community Applications
2. Create a new stack with the provided `docker-compose.yml`
3. Adjust volume paths to your Unraid shares (e.g., `/mnt/user/appdata/musicn-jf` and `/mnt/user/Music`)
4. Click "Compose Up"

### Method 2: Using Unraid Docker Template

1. Go to Docker tab in Unraid
2. Click "Add Container"
3. Configure the following:

**Container Settings:**
- Name: `musicn-jf`
- Repository: `musicn-jf:latest` (or build from source)
- Network Type: `Bridge`

**Port Mappings:**
- Container Port: `17890`
- Host Port: `17890`
- Connection Type: `TCP`

**Volume Mappings:**
- Container Path: `/config`
  - Host Path: `/mnt/user/appdata/musicn-jf/config`
  - Access Mode: `Read/Write`

- Container Path: `/music`
  - Host Path: `/mnt/user/Music` (or your preferred music library path)
  - Access Mode: `Read/Write`

**Environment Variables:**
- `PORT=17890`
- `CONFIG_DIR=/config`
- `STAGING_DIR=/music/_staging`
- `LIBRARY_DIR=/music/Library`
- `DEFAULT_SERVICE=migu`

4. Click "Apply" to start the container
5. Access WebUI at `http://[UNRAID-IP]:17890`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `17890` | Port for the web server |
| `CONFIG_DIR` | `/config` | Directory for configuration and database |
| `STAGING_DIR` | `/music/_staging` | Temporary download directory |
| `LIBRARY_DIR` | `/music/Library` | Final music library directory |
| `DEFAULT_SERVICE` | `migu` | Default music service |

### Directory Structure

After downloading music, files are organized as:
```
/music/Library/
  ├── {Artist}/
  │   └── Singles/
  │       └── {Title}.{ext}
```

For example:
```
/music/Library/
  ├── Taylor Swift/
  │   └── Singles/
  │       └── Shake It Off.mp3
```

## API Reference

### Health Check
```
GET /api/health
```

### Search Music
```
GET /api/search?service=migu&text=song+name&pageNum=1&pageSize=20
```

Parameters:
- `service`: Music service (currently only `migu` supported)
- `text`: Search query
- `pageNum`: Page number (default: 1)
- `pageSize`: Results per page (default: 20)

### Create Download Task
```
POST /api/tasks
Content-Type: application/json

{
  "service": "migu",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "coverUrl": "https://...",
  "downloadUrl": "https://...",
  "fileSize": "5.2MB",
  "format": "MP3"
}
```

### List All Tasks
```
GET /api/tasks
```

### Get Specific Task
```
GET /api/tasks/:id
```

## Task Status Flow

Tasks go through the following states:
1. `queued` - Task created, waiting to start
2. `downloading` - File is being downloaded
3. `organizing` - Moving file from staging to library
4. `done` - Download and organization complete
5. `failed` - An error occurred (check `error_message`)

## Troubleshooting

### Container won't start
- Check that volume paths exist and have proper permissions
- Verify port 17890 is not already in use
- Check Docker logs: `docker logs musicn-jf`

### Downloads fail
- Verify network connectivity from container
- Check that staging and library directories are writable
- Review task error messages in the WebUI

### Database issues
- Database file is stored at `{CONFIG_DIR}/db.sqlite`
- To reset: stop container, delete `config/db.sqlite`, restart

## Development

### Project Structure
```
.
├── src/
│   ├── server.js          # Express server and API routes
│   ├── config.js          # Configuration management
│   ├── db/
│   │   └── database.js    # SQLite database operations
│   ├── services/
│   │   ├── migu.js        # Migu music search integration
│   │   └── downloader.js  # Download queue processor
│   └── utils/
│       └── fileUtils.js   # File sanitization and organization
├── public/
│   ├── index.html         # WebUI HTML
│   ├── style.css          # WebUI styles
│   └── app.js             # WebUI JavaScript
├── Dockerfile             # Docker image definition
├── docker-compose.yml     # Docker Compose configuration
└── package.json           # Node.js dependencies
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
