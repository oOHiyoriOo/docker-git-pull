const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REPOS_DIR = process.env.REPOS_DIR || path.join(__dirname, 'repos');
const SSH_DIR = '/root/.ssh';

// Middleware to parse raw body for signature validation
app.use('/webhook', express.raw({ type: 'application/json' }));

// Load or generate webhook configuration
const CONFIG_FILE = path.join(__dirname, 'webhook-config.json');
let config = loadOrCreateConfig();

// ============================================================================
// Configuration Management
// ============================================================================

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading config file:', err.message);
    }
  }

  return createDefaultConfig();
}

function createDefaultConfig() {
  const newConfig = {
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
    defaultBranch: process.env.DEFAULT_BRANCH || 'main',
    autoClone: process.env.AUTO_CLONE !== 'false',
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  logConfigCreation(newConfig);

  return newConfig;
}

function logConfigCreation(config) {
  console.log('Created new webhook configuration at:', CONFIG_FILE);
  console.log('GitHub Webhook Secret:', config.githubWebhookSecret);
  console.log('Default Branch:', config.defaultBranch);
  console.log('Auto Clone:', config.autoClone);
}

// ============================================================================
// Security & Validation
// ============================================================================

function validateGitHubSignature(payload, signature) {
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch (err) {
    return false;
  }
}

// ============================================================================
// Git Operations
// ============================================================================

function execGitCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function gitClone(repoUrl, repoPath, branch) {
  const command = `git clone ${repoUrl} . && git checkout ${branch}`;
  return execGitCommand(command, repoPath);
}

function gitPull(repoPath) {
  const command = 'git pull origin';
  return execGitCommand(command, repoPath);
}

function getCurrentBranch(repoPath) {
  const command = 'git rev-parse --abbrev-ref HEAD';
  return execGitCommand(command, repoPath);
}

// ============================================================================
// Directory Operations
// ============================================================================

function isDirectoryEmpty(dirPath) {
  const files = fs.readdirSync(dirPath);
  return files.length === 0 || files.every(file => file.startsWith('.') && file !== '.git');
}

function ensureDirectoryExists(dirPath, description) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created ${description} at:`, dirPath);
  }
}

function cleanupDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath) && isDirectoryEmpty(dirPath)) {
      fs.rmSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to clean up directory:', err.message);
  }
}

// ============================================================================
// SSH Key Management
// ============================================================================

function findExistingSSHKey() {
  const keyTypes = [
    { private: 'id_ed25519', public: 'id_ed25519.pub' },
    { private: 'id_rsa', public: 'id_rsa.pub' }
  ];

  for (const keyType of keyTypes) {
    const privateKeyPath = path.join(SSH_DIR, keyType.private);
    const publicKeyPath = path.join(SSH_DIR, keyType.public);

    if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
      return { type: keyType.private, publicPath: publicKeyPath };
    }
  }

  return null;
}

function readPublicKey(publicKeyPath) {
  return fs.readFileSync(publicKeyPath, 'utf8').trim();
}

function displaySSHKey(publicKey, isNew = false) {
  console.log('');
  console.log(isNew ? 'NEW SSH Public Key Generated:' : 'SSH Public Key:');
  console.log((isNew ? '=' : '-').repeat(60));
  console.log(publicKey);
  console.log((isNew ? '=' : '-').repeat(60));

  if (isNew) {
    console.log('IMPORTANT: Add this key to your GitHub account!');
    console.log('Go to: https://github.com/settings/ssh/new');
  } else {
    console.log('Add this key to your GitHub account (Settings > SSH Keys)');
  }
  console.log('');
}

function generateSSHKey() {
  return new Promise((resolve, reject) => {
    const privateKeyPath = path.join(SSH_DIR, 'id_ed25519');
    const publicKeyPath = path.join(SSH_DIR, 'id_ed25519.pub');
    const command = `ssh-keygen -t ed25519 -f ${privateKeyPath} -N "" -C "github-webhook-server"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to generate SSH key:', error.message);
        reject(error);
        return;
      }

      console.log('SSH key generated successfully!');

      // Set correct permissions
      fs.chmodSync(privateKeyPath, 0o600);
      fs.chmodSync(publicKeyPath, 0o644);

      const publicKey = readPublicKey(publicKeyPath);
      displaySSHKey(publicKey, true);

      resolve({ exists: false, publicKey });
    });
  });
}

function checkAndSetupSSHKey() {
  return new Promise((resolve, reject) => {
    // Ensure SSH directory exists
    ensureDirectoryExists(SSH_DIR, 'SSH directory');
    fs.chmodSync(SSH_DIR, 0o700);

    // Check for existing key
    const existingKey = findExistingSSHKey();

    if (existingKey) {
      console.log('Found existing SSH key:', existingKey.type);
      const publicKey = readPublicKey(existingKey.publicPath);
      displaySSHKey(publicKey, false);
      resolve({ exists: true, publicKey });
    } else {
      console.log('No SSH key found, generating new ed25519 key...');
      generateSSHKey().then(resolve).catch(reject);
    }
  });
}

// ============================================================================
// Response Builders
// ============================================================================

function buildSuccessResponse(repoName, action, output, branch = null) {
  const response = {
    success: true,
    repository: repoName,
    action,
    output,
    message: action === 'cloned' ? 'Repository cloned successfully' : 'Repository updated successfully'
  };

  if (branch) {
    response.branch = branch;
  }

  return response;
}

function buildErrorResponse(repoName, action, error, stderr = null, status = null) {
  const response = {
    success: false,
    repository: repoName,
    action,
    error: error.message || error || `Git ${action} failed`
  };

  if (stderr) {
    response.stderr = stderr;
  }

  if (status) {
    response.status = status;
  }

  return response;
}

// ============================================================================
// Webhook Payload Processing
// ============================================================================

function parsePayload(rawBody) {
  try {
    return JSON.parse(rawBody.toString());
  } catch (err) {
    throw new Error('Invalid JSON payload');
  }
}

function extractRepositoryInfo(payload) {
  return {
    name: payload.repository?.name,
    sshUrl: payload.repository?.ssh_url,
    defaultBranch: payload.repository?.default_branch || config.defaultBranch
  };
}

function extractBranchFromRef(ref) {
  // GitHub sends refs like "refs/heads/main" or "refs/heads/feature-branch"
  if (!ref) {
    return null;
  }
  const match = ref.match(/^refs\/heads\/(.+)$/);
  return match ? match[1] : null;
}

function validateRepositoryInfo(repoInfo) {
  if (!repoInfo.name) {
    throw new Error('No repository name found');
  }
}

// ============================================================================
// Repository Operations
// ============================================================================

function getRepositoryPaths(repoName) {
  const repoPath = path.join(REPOS_DIR, repoName);
  const gitDir = path.join(repoPath, '.git');
  return { repoPath, gitDir };
}

function determineRepositoryAction(repoPath, gitDir) {
  const pathExists = fs.existsSync(repoPath);
  const isGitRepo = fs.existsSync(gitDir);

  return {
    needsClone: !pathExists || (pathExists && !isGitRepo),
    pathExists,
    isGitRepo
  };
}

function validateClonePrerequisites(repoSshUrl, repoPath) {
  if (!config.autoClone) {
    throw {
      status: 404,
      error: 'Repository directory not found',
      message: `Auto-clone is disabled. Please clone the repository to ${repoPath} manually or enable autoClone in config`
    };
  }

  if (!repoSshUrl) {
    throw {
      status: 400,
      error: 'No repository SSH URL found in payload'
    };
  }
}

function prepareRepositoryDirectory(repoPath) {
  if (!fs.existsSync(repoPath)) {
    console.log(`Creating directory: ${repoPath}`);
    fs.mkdirSync(repoPath, { recursive: true });
  } else if (!isDirectoryEmpty(repoPath)) {
    throw {
      status: 400,
      error: 'Directory exists but is not empty',
      message: `${repoPath} exists and contains files but is not a git repository. Please clean it manually.`
    };
  }
}

async function handleRepositoryClone(repoName, repoSshUrl, repoPath, defaultBranch) {
  console.log(`Cloning repository ${repoName} from ${repoSshUrl} (branch: ${defaultBranch})...`);

  try {
    const result = await gitClone(repoSshUrl, repoPath, defaultBranch);
    console.log(`Git clone successful for ${repoName}`);
    console.log('Output:', result.stdout);

    return buildSuccessResponse(repoName, 'cloned', result.stdout, defaultBranch);
  } catch (err) {
    console.error(`Git clone failed for ${repoName}:`, err.error?.message || err.stderr);
    cleanupDirectory(repoPath);
    throw buildErrorResponse(repoName, 'clone', err.error?.message || 'Git clone failed', err.stderr, 500);
  }
}

async function handleRepositoryPull(repoName, repoPath) {
  console.log(`Pulling changes for ${repoName}...`);

  try {
    const result = await gitPull(repoPath);
    console.log(`Git pull successful for ${repoName}`);
    console.log('Output:', result.stdout);

    return buildSuccessResponse(repoName, 'pulled', result.stdout);
  } catch (err) {
    console.error(`Git pull failed for ${repoName}:`, err.error?.message || err.stderr);
    throw buildErrorResponse(repoName, 'pull', err.error?.message || 'Git pull failed', err.stderr, 500);
  }
}

// ============================================================================
// Webhook Handler
// ============================================================================

async function handleWebhookRequest(req, res) {
  // Validate signature
  const signature = req.headers['x-hub-signature-256'];
  if (!validateGitHubSignature(req.body, signature)) {
    console.log('Invalid GitHub signature - request rejected');
    return res.status(401).json({ error: 'Unauthorized - Invalid GitHub signature' });
  }

  // Parse and extract payload
  let payload, repoInfo;
  try {
    payload = parsePayload(req.body);
    repoInfo = extractRepositoryInfo(payload);
    validateRepositoryInfo(repoInfo);
  } catch (err) {
    console.error('Error processing payload:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const event = req.headers['x-github-event'];
  console.log(`Received ${event} event for repository: ${repoInfo.name}`);

  // Only process push events
  if (event !== 'push') {
    console.log(`Ignoring non-push event: ${event}`);
    return res.json({
      success: true,
      message: `Event '${event}' ignored - only push events are processed`
    });
  }

  // Extract branch from the webhook payload
  const pushBranch = extractBranchFromRef(payload.ref);
  if (!pushBranch) {
    console.log('Could not extract branch from webhook payload');
    return res.status(400).json({
      error: 'Invalid payload - could not extract branch from ref',
      ref: payload.ref
    });
  }

  console.log(`Push event for branch: ${pushBranch}`);

  // Determine repository paths and action
  const { repoPath, gitDir } = getRepositoryPaths(repoInfo.name);
  const { needsClone } = determineRepositoryAction(repoPath, gitDir);

  try {
    let response;

    if (needsClone) {
      // For new clones, check if the push is for the default branch
      if (pushBranch !== repoInfo.defaultBranch) {
        console.log(`Ignoring push to branch '${pushBranch}' - repository will be cloned with default branch '${repoInfo.defaultBranch}'`);
        return res.json({
          success: true,
          message: `Push to branch '${pushBranch}' ignored - repository not yet cloned (will clone '${repoInfo.defaultBranch}' on first push to that branch)`
        });
      }

      // Validate and prepare for clone
      validateClonePrerequisites(repoInfo.sshUrl, repoPath);
      prepareRepositoryDirectory(repoPath);

      // Perform clone
      response = await handleRepositoryClone(
        repoInfo.name,
        repoInfo.sshUrl,
        repoPath,
        repoInfo.defaultBranch
      );
    } else {
      // For existing repos, check if the push is for the current branch
      let currentBranch;
      try {
        const currentBranchResult = await getCurrentBranch(repoPath);
        currentBranch = currentBranchResult.stdout.trim();
      } catch (err) {
        console.error(`Failed to get current branch for ${repoInfo.name}:`, err.error?.message || err.stderr);
        return res.status(500).json({
          success: false,
          repository: repoInfo.name,
          error: 'Failed to get current branch',
          details: err.error?.message || err.stderr,
          message: 'Could not determine the current branch of the local repository. The repository may be corrupted.'
        });
      }

      console.log(`Local repository is on branch: ${currentBranch}`);

      if (pushBranch !== currentBranch) {
        console.log(`Ignoring push to branch '${pushBranch}' - local repository is on branch '${currentBranch}'`);
        return res.json({
          success: true,
          message: `Push to branch '${pushBranch}' ignored - local repository is on branch '${currentBranch}'`
        });
      }

      // Perform pull
      response = await handleRepositoryPull(repoInfo.name, repoPath);
    }

    res.json(response);
  } catch (err) {
    // Handle validation errors with custom status codes
    if (err.status) {
      return res.status(err.status).json({ error: err.error, message: err.message });
    }

    // Handle operation errors
    res.status(500).json(err);
  }
}

// ============================================================================
// Express Routes
// ============================================================================

app.post('/webhook', handleWebhookRequest);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    reposDir: REPOS_DIR,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'GitHub Webhook Git Pull Server',
    endpoints: {
      webhook: '/webhook (POST)',
      health: '/health (GET)'
    },
    reposDir: REPOS_DIR
  });
});

// ============================================================================
// Server Initialization
// ============================================================================

function displayServerInfo(sshKeyInfo) {
  console.log('='.repeat(60));
  console.log('GitHub Webhook Git Pull Server');
  console.log('='.repeat(60));
  console.log(`Server running on port ${PORT}`);
  console.log(`Repositories directory: ${REPOS_DIR}`);
  console.log('');
  console.log('Webhook Configuration:');
  console.log('  Webhook URL:', `http://localhost:${PORT}/webhook`);
  console.log('  GitHub Webhook Secret:', config.githubWebhookSecret);
  console.log('');
  console.log('SSH Public Key (add to GitHub):');
  console.log('-'.repeat(60));
  console.log(sshKeyInfo.publicKey);
  console.log('-'.repeat(60));
  console.log('');
  console.log('Next Steps:');
  console.log('1. Add the SSH public key above to GitHub:');
  console.log('   https://github.com/settings/ssh/new');
  console.log('2. Clone repositories to:', REPOS_DIR);
  console.log('3. Configure webhook URL and secret in GitHub settings');
  console.log('='.repeat(60));
}

async function startServer() {
  try {
    // Setup SSH key
    const sshKeyInfo = await checkAndSetupSSHKey();

    // Ensure repos directory exists
    ensureDirectoryExists(REPOS_DIR, 'repos directory');

    // Start listening
    app.listen(PORT, () => {
      displayServerInfo(sshKeyInfo);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
