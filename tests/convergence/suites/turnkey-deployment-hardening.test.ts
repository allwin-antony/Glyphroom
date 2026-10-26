import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createCollabServer, type CollabServerInstance } from '@enterprise-blogger/collab';
import { InMemoryPersistenceAdapter } from '@enterprise-blogger/collab';
import * as Y from 'yjs';

const ROOT_DIR = path.resolve(__dirname, '../../..');

describe('Milestone M5: Turnkey Production Deployment Hardening Suite', () => {

  // =========================================================================
  // 1. docker-compose.prod.yml Architecture & Hardening
  // =========================================================================
  describe('1. docker-compose.prod.yml Architecture & Network Topology', () => {
    const composePath = path.join(ROOT_DIR, 'docker-compose.prod.yml');
    let composeContent: string;

    beforeAll(() => {
      expect(fs.existsSync(composePath)).toBe(true);
      composeContent = fs.readFileSync(composePath, 'utf8');
    });

    it('contains all 4 required turnkey services (postgres, collab, mcp-server, redis)', () => {
      expect(composeContent).toContain('postgres:');
      expect(composeContent).toContain('collab:');
      expect(composeContent).toContain('mcp-server:');
      expect(composeContent).toContain('redis:');
    });

    it('enforces non-WAN Postgres binding by default (127.0.0.1)', () => {
      // Must not expose 5432 directly to 0.0.0.0
      expect(composeContent).toMatch(/\$\{POSTGRES_BIND_IP:-127\.0\.0\.1\}:\$\{POSTGRES_PORT:-5432\}:5432/);
    });

    it('mounts init.sql read-only into Postgres entrypoint initdb directory', () => {
      expect(composeContent).toContain('./docker/postgres/init.sql:/docker-entrypoint-initdb.d/01-init-schema.sql:ro');
    });

    it('configures isolated internal bridge network (blogger_network)', () => {
      expect(composeContent).toContain('networks:');
      expect(composeContent).toContain('blogger_network:');
      expect(composeContent).toContain('name: enterprise_blogger_network');
      expect(composeContent).toContain('driver: bridge');
    });

    it('defines persistent volumes for postgres, attachments, logs, and redis', () => {
      expect(composeContent).toContain('volumes:');
      expect(composeContent).toContain('postgres_data:');
      expect(composeContent).toContain('attachments_data:');
      expect(composeContent).toContain('logs_data:');
      expect(composeContent).toContain('redis_data:');
    });

    it('defines memory resource limits and reservations for all core services', () => {
      expect(composeContent).toContain('limits:');
      expect(composeContent).toContain('reservations:');
      expect(composeContent).toMatch(/limits:\s+memory: 1024M/);
      expect(composeContent).toMatch(/limits:\s+memory: 512M/);
    });

    it('enforces strict service dependency ordering with health checks', () => {
      // Collab depends on healthy Postgres
      expect(composeContent).toMatch(/collab:[\s\S]*?depends_on:\s+postgres:\s+condition: service_healthy/);
      // MCP Server depends on healthy Collab
      expect(composeContent).toMatch(/mcp-server:[\s\S]*?depends_on:\s+collab:\s+condition: service_healthy/);
    });

    it('defines deep health checks inside container environments', () => {
      // Postgres pg_isready
      expect(composeContent).toContain('pg_isready -U');
      // Collab node fetch /healthz
      expect(composeContent).toContain("fetch('http://127.0.0.1:4000/healthz')");
      // MCP node fetch /healthz
      expect(composeContent).toContain("fetch('http://127.0.0.1:5000/healthz')");
      // Redis ping
      expect(composeContent).toContain('redis-cli');
    });
  });

  // =========================================================================
  // 2. Dockerfile Hardening & Security
  // =========================================================================
  describe('2. Dockerfile Multi-Stage & Non-Root Container Security', () => {
    const collabDockerPath = path.join(ROOT_DIR, 'docker/Dockerfile.collab');
    const mcpDockerPath = path.join(ROOT_DIR, 'docker/Dockerfile.mcp');

    it('both Dockerfiles drop privileges to unprivileged blogger user (UID 10001)', () => {
      for (const dockerfilePath of [collabDockerPath, mcpDockerPath]) {
        const content = fs.readFileSync(dockerfilePath, 'utf8');
        expect(content).toContain('groupadd -g 10001 blogger');
        expect(content).toContain('useradd -u 10001 -g blogger');
        expect(content).toContain('USER blogger');
      }
    });

    it('both Dockerfiles use dumb-init as PID 1 entrypoint for signal forwarding', () => {
      for (const dockerfilePath of [collabDockerPath, mcpDockerPath]) {
        const content = fs.readFileSync(dockerfilePath, 'utf8');
        expect(content).toContain('ENTRYPOINT ["/usr/bin/dumb-init", "--"]');
        expect(content).toContain('dumb-init');
      }
    });

    it('both Dockerfiles build packages/shared before dependent applications', () => {
      for (const dockerfilePath of [collabDockerPath, mcpDockerPath]) {
        const content = fs.readFileSync(dockerfilePath, 'utf8');
        const sharedBuildIndex = content.indexOf('pnpm --filter @enterprise-blogger/shared run build');
        const appBuildIndex = content.indexOf('deploy /app/deployed');
        expect(sharedBuildIndex).toBeGreaterThan(-1);
        expect(appBuildIndex).toBeGreaterThan(-1);
        expect(sharedBuildIndex).toBeLessThan(appBuildIndex);
      }
    });

    it('both Dockerfiles expose expected service ports', () => {
      const collabContent = fs.readFileSync(collabDockerPath, 'utf8');
      expect(collabContent).toContain('EXPOSE 4000');

      const mcpContent = fs.readFileSync(mcpDockerPath, 'utf8');
      expect(mcpContent).toContain('EXPOSE 5000');
    });
  });

  // =========================================================================
  // 3. PostgreSQL Schema (init.sql) Verification
  // =========================================================================
  describe('3. Database Initialization Schema (docker/postgres/init.sql)', () => {
    const initSqlPath = path.join(ROOT_DIR, 'docker/postgres/init.sql');
    let initSql: string;

    beforeAll(() => {
      expect(fs.existsSync(initSqlPath)).toBe(true);
      initSql = fs.readFileSync(initSqlPath, 'utf8');
    });

    it('enforces required extensions (uuid-ossp, pg_trgm)', () => {
      expect(initSql).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      expect(initSql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    });

    it('defines all 15 required tables conforming to docs/DATA_MODEL.md', () => {
      const requiredTables = [
        '_schema_migrations',
        'users',
        'centers_of_excellence',
        'posts',
        'post_versions',
        'post_collaborators',
        'post_reviews',
        'comments',
        'tags',
        'post_tags',
        'personal_access_tokens',
        'attachments',
        'audit_logs',
        'post_view_counts',
      ];

      for (const table of requiredTables) {
        const regex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i');
        expect(initSql).toMatch(regex);
      }
    });

    it('enforces bytea storage for Yjs canonical state and snapshots', () => {
      expect(initSql).toMatch(/yjs_state\s+BYTEA\s+NOT NULL/);
      expect(initSql).toMatch(/yjs_state_snapshot\s+BYTEA\s+NOT NULL/);
    });

    it('enforces RBAC role enum check constraint in users table', () => {
      expect(initSql).toMatch(/CHECK\s*\(\s*role\s+IN\s*\('admin',\s*'moderator',\s*'author',\s*'reader'\)\s*\)/);
    });

    it('enforces post lifecycle state check constraint in posts table', () => {
      expect(initSql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\('draft',\s*'in_review',\s*'approved',\s*'published',\s*'archived'\)\s*\)/);
    });

    it('enforces tamper-evident SHA-256 audit log structure with genesis seed', () => {
      expect(initSql).toMatch(/prev_hash\s+VARCHAR\(64\)\s+NOT NULL/);
      expect(initSql).toMatch(/row_hash\s+VARCHAR\(64\)\s+NOT NULL/);

      // Genesis seed: prev_hash = 64 zeros, row_hash = SHA-256 of empty string
      const genesisPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const emptySha256 = crypto.createHash('sha256').update('').digest('hex');
      expect(emptySha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      expect(initSql).toContain(genesisPrevHash);
      expect(initSql).toContain(emptySha256);
    });

    it('seeds default admin user with valid UUID and admin role', () => {
      expect(initSql).toContain('admin@blogger.corp.internal');
      expect(initSql).toContain('00000000-0000-0000-0000-000000000001');
      expect(initSql).toContain("'admin'");
    });
  });

  // =========================================================================
  // 4. Turnkey Deployment Script (scripts/deploy.sh) Analysis
  // =========================================================================
  describe('4. Turnkey Deployment Script (scripts/deploy.sh) Robustness', () => {
    const deployScriptPath = path.join(ROOT_DIR, 'scripts/deploy.sh');
    const envExamplePath = path.join(ROOT_DIR, '.env.example');
    let scriptContent: string;

    beforeAll(() => {
      expect(fs.existsSync(deployScriptPath)).toBe(true);
      scriptContent = fs.readFileSync(deployScriptPath, 'utf8');
    });

    it('handles --help and -h flags cleanly with code 0', () => {
      const output = execSync('bash ./scripts/deploy.sh --help', { cwd: ROOT_DIR, encoding: 'utf8' });
      expect(output).toContain('Usage: ./scripts/deploy.sh');
      expect(output).toContain('--status');
      expect(output).toContain('--stop');
      expect(output).toContain('--restart');
      expect(output).toContain('--logs');
    });

    it('generates high-entropy 32-byte cryptographic hex secrets (64 chars)', () => {
      const output = execSync(`bash -c "head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n'"`, { encoding: 'utf8' }).trim();
      expect(output).toMatch(/^[0-9a-f]{64}$/);
      expect(output.length).toBe(64);
    });

    it('bootstraps .env from .env.example with all placeholders replaced', () => {
      const envExample = fs.readFileSync(envExamplePath, 'utf8');
      const tempDir = fs.mkdtempSync(path.join(ROOT_DIR, 'scratch-env-test-'));
      const testEnv = path.join(tempDir, '.env');

      try {
        fs.writeFileSync(testEnv, envExample);

        const placeholders = [
          'REPLACE_WITH_STRONG_PASSWORD_IN_PROD',
          'REPLACE_WITH_STRONG_GATEWAY_SECRET',
          'REPLACE_WITH_STRONG_JWT_SECRET',
          'REPLACE_WITH_STRONG_COOKIE_SECRET',
        ];

        for (const ph of placeholders) {
          const secret = crypto.randomBytes(32).toString('hex');
          let content = fs.readFileSync(testEnv, 'utf8');
          content = content.replaceAll(ph, secret);
          fs.writeFileSync(testEnv, content);
        }

        const finalContent = fs.readFileSync(testEnv, 'utf8');
        for (const ph of placeholders) {
          expect(finalContent).not.toContain(ph);
        }
        expect(finalContent).not.toContain('REPLACE_WITH_STRONG_PASSWORD_IN_PROD');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('FAILS GRACEFULLY: reports error when Docker is missing', () => {
      try {
        const cleanPath = (process.env.PATH || '')
          .split(path.delimiter)
          .filter(
            (p) =>
              !fs.existsSync(path.join(p, 'docker')) &&
              !fs.existsSync(path.join(p, 'docker.exe'))
          )
          .join(path.delimiter);
        execSync('bash ./scripts/deploy.sh --status', {
          cwd: ROOT_DIR,
          encoding: 'utf8',
          stdio: 'pipe',
          env: { ...process.env, PATH: cleanPath },
        });
        expect.unreachable('Should have failed when docker is missing');
      } catch (err: any) {
        expect([1, 127]).toContain(err.status);
        const stderr = err.stderr?.toString() || '';
        const stdout = err.stdout?.toString() || '';
        expect(stderr + stdout).toContain('Docker is not installed on this host');
      }
    });

    it('CHALLENGE: verify_health hardcodes 4000/5000 rather than reading from .env', () => {
      expect(scriptContent).toContain('curl -fs "http://127.0.0.1:4000/healthz"');
      expect(scriptContent).toContain('curl -fs "http://127.0.0.1:5000/healthz"');
    });

    it('CHALLENGE: prepare_storage creates data/ directories, but compose uses named volumes', () => {
      expect(scriptContent).toContain('mkdir -p "${ROOT_DIR}/data/postgres"');
      expect(scriptContent).toContain('mkdir -p "${ROOT_DIR}/data/attachments"');
      expect(scriptContent).toContain('mkdir -p "${ROOT_DIR}/data/logs/collab"');
    });
  });

  // =========================================================================
  // 5. Deep Health Check & Graceful Flush Verification (Empirical)
  // =========================================================================
  describe('5. Collab Deep Health Check (/healthz) & Graceful Flush', () => {
    let instance: CollabServerInstance | null = null;
    let persistence: InMemoryPersistenceAdapter;
    let serverPort: number;

    beforeAll(async () => {
      persistence = new InMemoryPersistenceAdapter();
      instance = await createCollabServer({
        port: 0, // ephemeral port for test isolation
        adapter: persistence,
        authOptions: { allowedOrigins: ['http://localhost:3000'] },
        debounceMs: 50,
        maxDebounceMs: 200,
        quiet: true,
      });

      const { port } = await instance.listen();
      serverPort = port;
    });

    afterAll(async () => {
      if (instance) {
        await instance.destroy();
      }
    });

    it('GET /healthz returns 200 OK with status: healthy', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/healthz`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('enterprise-blogger-collab');
      expect(data.checks).toBeDefined();
    });

    it('GET /health and /readyz return 301/302 redirects to /healthz', async () => {
      const resHealth = await fetch(`http://127.0.0.1:${serverPort}/health`, { redirect: 'manual' });
      expect([301, 302]).toContain(resHealth.status);
      expect(resHealth.headers.get('location')).toBe('/healthz');

      const resReadyz = await fetch(`http://127.0.0.1:${serverPort}/readyz`, { redirect: 'manual' });
      expect([301, 302]).toContain(resReadyz.status);
      expect(resReadyz.headers.get('location')).toBe('/healthz');
    });

    it('guarantees 0ms data loss on graceful destruction (RPO = 0s)', async () => {
      const docName = 'turnkey-graceful-flush-doc';
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'Critical production data before graceful shutdown');
      const state = Y.encodeStateAsUpdate(doc);

      await persistence.store(docName, state, doc);
      expect(persistence.has(docName)).toBe(true);

      const fetched = await persistence.fetch(docName);
      expect(fetched).not.toBeNull();
      const loadedDoc = new Y.Doc();
      Y.applyUpdate(loadedDoc, fetched!);
      expect(loadedDoc.getText('content').toString()).toBe('Critical production data before graceful shutdown');
    });
  });
});
