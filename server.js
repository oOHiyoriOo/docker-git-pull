const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REPOS_DIR = process.env.REPOS_DIR || path.join(__dirname, 'repos');

// Middleware to parse raw body for signature validation
app.use('/webhook', express.raw({ type: 'application/json' }));

// Load or generate webhook configuration
const CONFIG_FILE = path.join(__dirname, 'webhook-config.json');
let config = loadOrCreateConfig();

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading config file:', err.message);
    }
  }

  // Generate new config
  const newConfig = {
    urlSecret: crypto.randomBytes(32).toString('hex'),
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  console.log('Created new webhook configuration at:', CONFIG_FILE);
  console.log('URL Secret:', newConfig.urlSecret);
  console.log('GitHub Webhook Secret:', newConfig.githubWebhookSecret);

  return newConfig;
}

// Validate GitHub webhook signature
function validateGitHubSignature(payload, signature) {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch (err) {
    return false;
  }
}

// Execute git pull in repository directory
function gitPull(repoPath) {
  return new Promise((resolve, reject) => {
    const gitCommand = 'git pull origin';

    exec(gitCommand, { cwd: repoPath }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Ensure repos directory exists
if (!fs.existsSync(REPOS_DIR)) {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  console.log('Created repos directory at:', REPOS_DIR);
}

// GitHub webhook endpoint with URL secret
app.post('/webhook/:urlSecret', async (req, res) => {
  const { urlSecret } = req.params;

  // Validate URL secret
  if (urlSecret !== config.urlSecret) {
    console.log('Invalid URL secret attempt');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Validate GitHub signature
  const signature = req.headers['x-hub-signature-256'];
  if (!validateGitHubSignature(req.body, signature)) {
    console.log('Invalid GitHub signature');
    return res.status(401).json({ error: 'Unauthorized - Invalid signature' });
  }

  // Parse the payload
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (err) {
    console.error('Error parsing payload:', err.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Extract repository information
  const repoName = payload.repository?.name;
  const event = req.headers['x-github-event'];

  if (!repoName) {
    console.log('No repository name in payload');
    return res.status(400).json({ error: 'No repository name found' });
  }

  console.log(`Received ${event} event for repository: ${repoName}`);

  // Check if repository directory exists
  const repoPath = path.join(REPOS_DIR, repoName);

  if (!fs.existsSync(repoPath)) {
    console.log(`Repository directory not found: ${repoPath}`);
    return res.status(404).json({
      error: 'Repository directory not found',
      message: `Please clone the repository to ${repoPath} first`
    });
  }

  // Check if it's a git repository
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log(`Not a git repository: ${repoPath}`);
    return res.status(400).json({
      error: 'Not a git repository',
      message: `${repoPath} exists but is not a git repository`
    });
  }

  // Perform git pull
  try {
    console.log(`Pulling changes for ${repoName}...`);
    const result = await gitPull(repoPath);

    console.log(`Git pull successful for ${repoName}`);
    console.log('Output:', result.stdout);

    res.json({
      success: true,
      repository: repoName,
      output: result.stdout,
      message: 'Repository updated successfully'
    });
  } catch (err) {
    console.error(`Git pull failed for ${repoName}:`, err.error?.message || err.stderr);

    res.status(500).json({
      success: false,
      repository: repoName,
      error: err.error?.message || 'Git pull failed',
      stderr: err.stderr
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    reposDir: REPOS_DIR,
    timestamp: new Date().toISOString()
  });
});

// Info endpoint (non-sensitive information)
app.get('/', (req, res) => {
  res.json({
    message: 'GitHub Webhook Git Pull Server',
    endpoints: {
      webhook: '/webhook/:urlSecret (POST)',
      health: '/health (GET)'
    },
    reposDir: REPOS_DIR
  });
});

// Start the server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('GitHub Webhook Git Pull Server');
  console.log('='.repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Repositories directory: ${REPOS_DIR}`);
  console.log('');
  console.log('Webhook URL:', `http://localhost:${PORT}/webhook/${config.urlSecret}`);
  console.log('GitHub Webhook Secret:', config.githubWebhookSecret);
  console.log('');
  console.log('Configure this URL in your GitHub repository webhook settings');
  console.log('='.repeat(60));
});
