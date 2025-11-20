# GitHub Webhook Git Pull Server

A simple Node.js server that handles GitHub webhooks and automatically pulls repository changes using SSH.

## Features

- **GitHub signature validation** - cryptographically secure verification that requests come from GitHub
- **Automatic repository cloning** - automatically clones new repositories on first webhook
- **Automatic git pull** - updates existing repositories when webhooks are received
- **Smart branch detection** - uses repository's default branch from GitHub or configurable fallback
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
- **defaultBranch**: Default branch to checkout when cloning (default: "main")
- **autoClone**: Enable/disable automatic repository cloning (default: true)

These settings will be displayed in the console when the server starts. The webhook secret must be configured in your GitHub webhook settings.

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

You have two options for setting up repositories:

#### Option 1: Automatic Cloning (Recommended)

With `autoClone` enabled (default), repositories are automatically cloned when the first webhook is received:

1. Just configure the webhook in GitHub (see below)
2. Trigger a push event or manually trigger the webhook
3. The server will automatically clone the repository to `repos/<repo-name>`

The server will:
- Create the repository directory automatically
- Clone using the SSH URL from GitHub
- Checkout the repository's default branch (from GitHub metadata)
- Use the configured fallback branch if GitHub doesn't specify one

#### Option 2: Manual Cloning

If you prefer manual control or have `autoClone` disabled:

1. Clone repositories into the `repos` directory using SSH:
```bash
cd repos
git clone git@github.com:username/repo-name.git
```

2. Ensure your SSH key is configured:
```bash
# Test SSH connection
ssh -T git@github.com
```

3. The repository name in the `repos` directory must match the GitHub repository name exactly

## How It Works

1. GitHub sends a webhook POST request when events occur (e.g., push)
2. Server validates the GitHub signature using HMAC SHA-256 to ensure the request is authentic
3. Server extracts the repository name, SSH URL, and default branch from the payload
4. Server checks if `/repos/<repository-name>` exists and contains a git repository:
   - **If directory doesn't exist or is empty** (and `autoClone` is enabled):
     - Creates the directory
     - Runs `git clone <ssh-url> .` in that directory
     - Checks out the default branch from GitHub (or configured fallback)
   - **If directory exists with .git**:
     - Runs `git pull origin` to update the repository
5. Server responds with success/failure status and action taken (cloned or pulled)

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

### Git clone/pull fails with authentication error

Ensure your SSH key is properly configured:
```bash
# Check SSH connection
ssh -T git@github.com

# Verify repository uses SSH URL
cd repos/your-repo
git remote -v
# Should show: git@github.com:username/repo.git
```

If auto-clone fails with authentication errors:
1. Ensure your SSH public key is added to your GitHub account
2. Check that the SSH key has correct permissions (600 for private key)
3. Verify the repository allows SSH access

### Auto-clone not working

If repositories aren't being cloned automatically:
1. Check that `autoClone` is set to `true` in `webhook-config.json`
2. Verify the webhook payload includes the `ssh_url` field
3. Ensure the SSH key is properly configured and added to GitHub
4. Check server logs for specific error messages
5. Manually trigger a webhook from GitHub to test

### Repository clone fails - directory not empty

If you see "Directory exists but is not empty":
1. The directory exists but doesn't contain a .git folder
2. Either clean the directory manually or
3. Clone the repository manually using SSH

### Webhook returns 404 - Repository not found (with autoClone disabled)

If `autoClone` is disabled:
1. Manually clone the repository to the `repos` directory
2. Ensure the directory name matches the GitHub repository name exactly
3. Verify it's a valid git repository (has `.git` directory)

Or enable `autoClone` in the configuration.

### Webhook returns 401 - Unauthorized

The GitHub signature validation failed:
1. Ensure the webhook secret in GitHub matches `githubWebhookSecret` in `webhook-config.json`
2. Check that the webhook content type is set to `application/json`
3. Verify the secret was copied correctly (no extra spaces or characters)

### Wrong branch being used

The server uses the default branch from GitHub's webhook payload. To change:
1. Check the repository's default branch on GitHub
2. Or set `defaultBranch` in `webhook-config.json` as a fallback
3. Note: The GitHub payload's default_branch takes precedence over config

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
