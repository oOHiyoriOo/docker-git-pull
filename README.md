# GitHub Webhook Git Pull Server

A simple Node.js server that handles GitHub webhooks and automatically pulls repository changes using SSH.

## Features

- **Secure webhook endpoints** with random URL secret
- **GitHub signature validation** to ensure requests come from GitHub
- **Automatic git pull** when webhooks are received
- **SSH support** for private repositories
- **Multiple repository support** - handles multiple repos in separate directories
- **Easy configuration** with auto-generated secrets

## Prerequisites

- Node.js (v14 or higher)
- Git
- SSH key configured for GitHub (for private repositories)

## Installation

1. Clone this repository:
```bash
git clone <your-repo-url>
cd docker-git-pull
```

2. Install dependencies:
```bash
npm install
```

3. Set up your repositories directory:
```bash
mkdir -p repos
```

4. Clone the repositories you want to auto-update into the `repos` directory using SSH:
```bash
cd repos
git clone git@github.com:username/repo-name.git
cd ..
```

## Configuration

### Environment Variables (Optional)

Create a `.env` file (see `.env.example`):

```env
PORT=3000
REPOS_DIR=/path/to/repos
GITHUB_WEBHOOK_SECRET=your-secret-here
```

### Auto-generated Configuration

On first run, the server will create `webhook-config.json` with:
- **urlSecret**: Random secret for the webhook URL
- **githubWebhookSecret**: Secret for validating GitHub signatures

These secrets will be displayed in the console when the server starts.

## Usage

### Start the Server

```bash
npm start
```

The server will display:
- The webhook URL to configure in GitHub
- The GitHub webhook secret to use

Example output:
```
============================================================
GitHub Webhook Git Pull Server
============================================================
Server running on port 3000
Repositories directory: /home/user/docker-git-pull/repos

Webhook URL: http://localhost:3000/webhook/abc123...
GitHub Webhook Secret: xyz789...

Configure this URL in your GitHub repository webhook settings
============================================================
```

### Configure GitHub Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: The webhook URL from server output (e.g., `http://your-server.com:3000/webhook/abc123...`)
   - **Content type**: `application/json`
   - **Secret**: The `githubWebhookSecret` from server output
   - **Events**: Choose "Just the push event" or customize as needed
4. Click **Add webhook**

### Repository Setup

For each repository you want to auto-update:

1. Clone it into the `repos` directory using SSH:
```bash
cd repos
git clone git@github.com:username/repo-name.git
```

2. Ensure your SSH key is configured:
```bash
# Test SSH connection
ssh -T git@github.com
```

3. The repository name in the `repos` directory should match the GitHub repository name

## How It Works

1. GitHub sends a webhook POST request when events occur (e.g., push)
2. Server validates the URL secret in the path
3. Server validates the GitHub signature using HMAC SHA-256
4. Server extracts the repository name from the payload
5. Server checks if `/repos/<repository-name>` exists
6. Server runs `git pull origin` in that directory using SSH
7. Server responds with success/failure status

## API Endpoints

### POST `/webhook/:urlSecret`
Receives GitHub webhook events and triggers git pull.

**Headers:**
- `X-Hub-Signature-256`: GitHub signature for validation
- `X-GitHub-Event`: Event type (e.g., "push")

**Response:**
```json
{
  "success": true,
  "repository": "repo-name",
  "output": "Already up to date.",
  "message": "Repository updated successfully"
}
```

### GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "reposDir": "/path/to/repos",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET `/`
Server information endpoint.

## Security Features

1. **URL Secret**: Random secret in the webhook URL path prevents unauthorized access
2. **Signature Validation**: Validates GitHub HMAC signature using SHA-256
3. **Timing-safe Comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks
4. **Path Validation**: Only pulls repositories that exist in the configured directory

## Troubleshooting

### Git pull fails with authentication error

Ensure your SSH key is properly configured:
```bash
# Check SSH connection
ssh -T git@github.com

# Verify repository uses SSH URL
cd repos/your-repo
git remote -v
# Should show: git@github.com:username/repo.git
```

### Webhook returns 404 - Repository not found

1. Check that the repository is cloned in the `repos` directory
2. Ensure the directory name matches the GitHub repository name exactly
3. Verify it's a valid git repository (has `.git` directory)

### Webhook returns 401 - Unauthorized

The GitHub signature validation failed:
1. Ensure the webhook secret in GitHub matches `githubWebhookSecret` in `webhook-config.json`
2. Check that the webhook content type is set to `application/json`

### Webhook returns 403 - Forbidden

The URL secret is incorrect:
1. Verify you're using the correct webhook URL from the server output
2. Check `webhook-config.json` for the current `urlSecret`

## Development

Run in development mode:
```bash
npm run dev
```

## Directory Structure

```
docker-git-pull/
├── server.js                    # Main server file
├── package.json                 # Dependencies
├── webhook-config.json          # Auto-generated secrets (gitignored)
├── .env                         # Environment variables (gitignored)
├── .env.example                 # Environment template
├── webhook-config.example.json  # Config template
├── repos/                       # Repositories directory (gitignored)
│   ├── repo1/
│   ├── repo2/
│   └── ...
└── README.md                    # This file
```

## Production Deployment

### Using a Reverse Proxy (Nginx)

```nginx
location /webhook {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### Using PM2

```bash
npm install -g pm2
pm2 start server.js --name github-webhook
pm2 save
pm2 startup
```

### Using Docker

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t github-webhook .
docker run -d -p 3000:3000 -v /path/to/repos:/app/repos github-webhook
```

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
