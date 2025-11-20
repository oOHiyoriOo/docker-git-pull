# GitHub Webhook Git Pull Server

A simple Node.js server that handles GitHub webhooks and automatically pulls repository changes using SSH.

## Features

- **GitHub signature validation** - cryptographically secure verification that requests come from GitHub
- **Automatic git pull** when webhooks are received
- **Automatic SSH key generation** - creates SSH keys if not present
- **SSH support** for private repositories
- **Multiple repository support** - handles multiple repos in separate directories
- **Easy configuration** with auto-generated webhook secret

## Prerequisites

- Node.js (v14 or higher)
- Git
- SSH key will be automatically generated if not present at `/root/.ssh/`

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
- **githubWebhookSecret**: Secret for validating GitHub webhook signatures (HMAC SHA-256)

This secret will be displayed in the console when the server starts and must be configured in your GitHub webhook settings.

## Usage

### Start the Server

```bash
npm start
```

On startup, the server will:
1. Check for SSH keys in `/root/.ssh/` (or generate new ones if missing)
2. Display the SSH public key for GitHub configuration
3. Show webhook configuration details

Example output:
```
Found existing SSH key: id_ed25519

SSH Public Key:
------------------------------------------------------------
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIxxx... github-webhook-server
------------------------------------------------------------
Add this key to your GitHub account (Settings > SSH Keys)

============================================================
GitHub Webhook Git Pull Server
============================================================
Server running on port 3000
Repositories directory: /home/user/docker-git-pull/repos

Webhook Configuration:
  Webhook URL: http://localhost:3000/webhook
  GitHub Webhook Secret: xyz789...

SSH Public Key (add to GitHub):
------------------------------------------------------------
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIxxx... github-webhook-server
------------------------------------------------------------

Next Steps:
1. Add the SSH public key above to GitHub:
   https://github.com/settings/ssh/new
2. Clone repositories to: /home/user/docker-git-pull/repos
3. Configure webhook URL and secret in GitHub settings
============================================================
```

### Add SSH Key to GitHub

The server will display your SSH public key on every startup. To add it to GitHub:

1. Copy the SSH public key from the server output
2. Go to [GitHub SSH Settings](https://github.com/settings/ssh/new)
3. Click "New SSH key"
4. Give it a title (e.g., "Webhook Server")
5. Paste the public key
6. Click "Add SSH key"

### Configure GitHub Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: The webhook URL from server output (e.g., `http://your-server.com:3000/webhook`)
   - **Content type**: `application/json`
   - **Secret**: The `githubWebhookSecret` from server output (this is required for security)
   - **Events**: Choose "Just the push event" or customize as needed
4. Click **Add webhook**

The secret enables GitHub to sign each webhook request with HMAC SHA-256, which the server validates to ensure the request is authentic.

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
2. Server validates the GitHub signature using HMAC SHA-256 to ensure the request is authentic
3. Server extracts the repository name from the payload
4. Server checks if `/repos/<repository-name>` exists
5. Server runs `git pull origin` in that directory using SSH
6. Server responds with success/failure status

## API Endpoints

### POST `/webhook`
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

1. **GitHub Signature Validation**: All webhook requests must include a valid HMAC SHA-256 signature
   - GitHub signs each request using the shared webhook secret
   - Server validates the signature to ensure the request is from GitHub
   - Requests without valid signatures are rejected with 401 Unauthorized
2. **Timing-safe Comparison**: Uses `crypto.timingSafeEqual` to prevent timing attacks
3. **Path Validation**: Only pulls repositories that exist in the configured directory
4. **Cryptographically Secure**: HMAC SHA-256 signature validation cannot be forged without the secret

This approach follows GitHub's official webhook security recommendations and is the industry standard for webhook authentication.

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
3. Verify the secret was copied correctly (no extra spaces or characters)

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
