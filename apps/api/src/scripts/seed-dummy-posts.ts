import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { 
  createDatabaseClient, 
  users, 
  posts, 
  postVersions, 
  postAttachments, 
  postViewCounts, 
  centersOfExcellence, 
  auditLogs 
} from '../db/index.js';
import { eq } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger';

// Helper: Build structured ProseMirror Yjs document
function buildRichYDoc(builder: (fragment: Y.XmlFragment) => void): { ydoc: Y.Doc; yjsState: Buffer; markdown: string } {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('prosemirror');
  builder(fragment);

  const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  let markdown = '';
  try {
    const pmJson = yDocToProsemirrorJSON(ydoc, 'prosemirror');
    markdown = exportDerivedMarkdown(pmJson as any);
  } catch (err) {
    markdown = '# Document\n\nExport generated.';
  }

  return { ydoc, yjsState, markdown };
}

// Helpers for creating ProseMirror XML elements
const createH = (level: number, text: string) => {
  const h = new Y.XmlElement('heading');
  h.setAttribute('level', String(level));
  h.insert(0, [new Y.XmlText(text)]);
  return h;
};

const createP = (text: string) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  return p;
};

const createCode = (code: string, language = 'typescript') => {
  const pre = new Y.XmlElement('codeBlock');
  pre.setAttribute('language', language);
  pre.insert(0, [new Y.XmlText(code)]);
  return pre;
};

const createAlert = (type: 'note' | 'tip' | 'warning' | 'caution', text: string) => {
  const alert = new Y.XmlElement('alert');
  alert.setAttribute('type', type);
  alert.insert(0, [createP(text)]);
  return alert;
};

const createStatusBlock = (opts: {
  ragStatus: 'green' | 'amber' | 'red';
  milestoneTitle: string;
  completionPercent: number;
  targetDate: string;
  blockers: string;
}) => {
  const s = new Y.XmlElement('projectStatusBlock');
  s.setAttribute('ragStatus', opts.ragStatus);
  s.setAttribute('milestoneTitle', opts.milestoneTitle);
  s.setAttribute('completionPercent', String(opts.completionPercent));
  s.setAttribute('targetDate', opts.targetDate);
  s.setAttribute('blockers', opts.blockers);
  return s;
};

const createMermaid = (code: string) => {
  const m = new Y.XmlElement('mermaidBlock');
  m.setAttribute('code', code);
  return m;
};

const createMath = (formula: string) => {
  const m = new Y.XmlElement('mathBlock');
  m.setAttribute('formula', formula);
  m.setAttribute('displayMode', 'true');
  return m;
};

const createTable = (headers: string[], rows: string[][]) => {
  const table = new Y.XmlElement('table');

  const headerRow = new Y.XmlElement('tableRow');
  headers.forEach((hText) => {
    const th = new Y.XmlElement('tableHeader');
    th.insert(0, [createP(hText)]);
    headerRow.insert(headerRow.length, [th]);
  });
  table.insert(0, [headerRow]);

  rows.forEach((rowCells) => {
    const tr = new Y.XmlElement('tableRow');
    rowCells.forEach((cellText) => {
      const td = new Y.XmlElement('tableCell');
      td.insert(0, [createP(cellText)]);
      tr.insert(tr.length, [td]);
    });
    table.insert(table.length, [tr]);
  });

  return table;
};

const createTaskList = (items: Array<{ text: string; checked: boolean }>) => {
  const taskList = new Y.XmlElement('taskList');
  items.forEach((item) => {
    const taskItem = new Y.XmlElement('taskItem');
    taskItem.setAttribute('checked', item.checked ? 'true' : 'false');
    taskItem.insert(0, [createP(item.text)]);
    taskList.insert(taskList.length, [taskItem]);
  });
  return taskList;
};

const createAttachment = (opts: {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  scanStatus: 'scanning' | 'clean' | 'blocked';
}) => {
  const att = new Y.XmlElement('fileAttachmentBlock');
  att.setAttribute('attachmentId', opts.attachmentId);
  att.setAttribute('fileName', opts.fileName);
  att.setAttribute('fileSize', String(opts.fileSize));
  att.setAttribute('mimeType', opts.mimeType);
  att.setAttribute('url', opts.url);
  att.setAttribute('scanStatus', opts.scanStatus);
  return att;
};

async function seed() {
  console.log('🚀 Connecting to PostgreSQL at:', DATABASE_URL.replace(/:[^:]*@/, ':****@'));
  const { db, pool, close } = createDatabaseClient({ connectionString: DATABASE_URL });

  // 1. Ensure storage directory exists
  const storageDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // 2. Ensure Centers of Excellence (COEs) exist
  console.log('📦 Seeding Centers of Excellence...');
  const coeList = [
    { name: 'Systems Architecture', code: 'ARCH', description: 'Enterprise system architecture, RFCs, and decision records.' },
    { name: 'SRE & Operations', code: 'SRE', description: 'Site reliability, incident retrospectives, runbooks, and telemetry.' },
    { name: 'Security & Compliance', code: 'SEC', description: 'Zero-trust architecture, vulnerability mitigation, and compliance controls.' },
    { name: 'Frontend & UX Engineering', code: 'FRONTEND', description: 'UI design systems, web performance, accessibility, and interactive canvases.' },
  ];

  const coeMap = new Map<string, string>();
  for (const c of coeList) {
    const [existing] = await db.select().from(centersOfExcellence).where(eq(centersOfExcellence.name, c.name)).limit(1);
    if (existing) {
      coeMap.set(c.code, existing.id);
    } else {
      const [inserted] = await db.insert(centersOfExcellence).values(c).returning();
      coeMap.set(c.code, inserted.id);
    }
  }

  // 3. Seed / Verify Users
  console.log('👥 Seeding Users (Admin, Staff SRE, Principal Architect, Frontend Lead)...');
  const defaultPasswordHash = await bcrypt.hash('admin2026!', 10);
  const userList = [
    {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'admin@enterprise-blogger.local',
      fullName: 'Break-Glass System Administrator',
      role: 'admin' as const,
      passwordHash: defaultPasswordHash,
      isActive: true,
    },
    {
      email: 'elena.rostova@enterprise.internal',
      fullName: 'Elena Rostova',
      role: 'author' as const,
      passwordHash: defaultPasswordHash,
      isActive: true,
    },
    {
      email: 'marcus.chen@enterprise.internal',
      fullName: 'Marcus Chen',
      role: 'moderator' as const,
      passwordHash: defaultPasswordHash,
      isActive: true,
    },
    {
      email: 'priya.sharma@enterprise.internal',
      fullName: 'Priya Sharma',
      role: 'author' as const,
      passwordHash: defaultPasswordHash,
      isActive: true,
    },
  ];

  const userMap = new Map<string, string>();
  for (const u of userList) {
    const [existing] = await db.select().from(users).where(eq(users.email, u.email)).limit(1);
    if (existing) {
      userMap.set(u.email, existing.id);
    } else {
      const [inserted] = await db.insert(users).values(u).returning();
      userMap.set(u.email, inserted.id);
    }
  }

  // Helper: create a physical dummy file on disk for attachments
  const createSampleAttachmentFile = async (name: string, content: Buffer | string) => {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const safeExt = path.extname(name) || '.bin';
    const storageFileName = `${sha256}${safeExt}`;
    const storagePath = path.join(storageDir, storageFileName);

    if (!fs.existsSync(storagePath)) {
      await fs.promises.writeFile(storagePath, buf);
    }

    return { sha256, storagePath, size: buf.length };
  };

  // 4. Create Rich Dummy Posts with ALL possible data types
  console.log('📝 Creating Rich Dummy Posts with Complete Block Variety...');

  // =========================================================================
  // POST 1: Authored by ADMIN USER (Break-Glass Admin)
  // Status: published
  // =========================================================================
  const adminId = userMap.get('admin@enterprise-blogger.local')!;
  const archCoeId = coeMap.get('ARCH')!;

  const sampleFile1 = await createSampleAttachmentFile(
    'enterprise_crdt_architecture_spec_v2.pdf',
    '%PDF-1.5 sample enterprise crdt architecture specification document\n%%EOF'
  );
  const sampleAttId1 = crypto.randomUUID();

  const post1Data = buildRichYDoc((frag) => {
    frag.insert(frag.length, [createH(1, 'Global Platform Architecture & High-Availability Status')]);
    frag.insert(frag.length, [
      createP(
        'This specification details Glyphroom’s collaborative editing architecture, single write authority synchronization pipeline, and multi-region failover protocols.'
      ),
    ]);

    // 1. Status Block
    frag.insert(frag.length, [
      createStatusBlock({
        ragStatus: 'green',
        milestoneTitle: 'Multi-Region Active-Active Sharding & Failover',
        completionPercent: 92,
        targetDate: '2026-11-15',
        blockers: 'Final latency SLO verification across cross-region clusters',
      }),
    ]);

    // 2. Alert Callouts
    frag.insert(frag.length, [
      createAlert('tip', 'Pro-Tip: When editing in Block View, use the ▲ and ▼ controls to safely reorder discrete section cards without keystroke loss.'),
    ]);

    // 3. Live Mermaid Sequence Diagram
    frag.insert(frag.length, [createH(2, 'Collaborative CRDT Transaction Sequence')]);
    frag.insert(frag.length, [
      createMermaid(
`sequenceDiagram
    autonumber
    actor Author as Staff Engineer (Web)
    participant UI as TipTap ProseMirror Canvas
    participant HP as Hocuspocus Collab Gateway
    participant YJS as In-Process Yjs Engine
    participant DB as PostgreSQL Cluster

    Author->>UI: Types keystroke
    UI->>HP: Binary Yjs Delta (WebSocket)
    HP->>YJS: Apply transaction with origin tracking
    YJS->>DB: Debounced BYTEA state flush
    DB-->>YJS: Transaction committed
    YJS-->>UI: Broadcast awareness & peer cursors`
      ),
    ]);

    // 4. KaTeX Math Formula
    frag.insert(frag.length, [createH(2, 'High-Availability Service Level Objective (SLO)')]);
    frag.insert(frag.length, [
      createMath('\\text{Availability} = 1 - \\frac{\\sum_{i=1}^M \\text{OutageDuration}_i}{T_{\\text{observation}}} \\ge 99.995\\%'),
    ]);

    // 5. Real Data Table
    frag.insert(frag.length, [createH(2, 'Global Service Mesh Node Matrix')]);
    frag.insert(frag.length, [
      createTable(
        ['Cluster Region', 'Role', 'Replication Lag (p99)', 'Throughput (ops/sec)', 'Status'],
        [
          ['us-east-1 (Primary)', 'Leader Node', '0.4 ms', '12,500', 'HEALTHY'],
          ['us-west-2 (Secondary)', 'Warm Standby', '1.2 ms', '8,200', 'HEALTHY'],
          ['eu-central-1 (Replica)', 'Read Replica', '2.8 ms', '5,400', 'HEALTHY'],
          ['ap-southeast-1 (Edge)', 'Read Replica', '4.1 ms', '3,900', 'SYNCING'],
        ]
      ),
    ]);

    // 6. Interactive Task Checklist
    frag.insert(frag.length, [createH(2, 'Production Readiness Sign-Off Checklist')]);
    frag.insert(frag.length, [
      createTaskList([
        { text: 'Deploy PostgreSQL connection pool with PgBouncer', checked: true },
        { text: 'Verify SHA-256 tamper-evident hash chain verification route', checked: true },
        { text: 'Configure automated magic-byte inspection on attachment uploads', checked: true },
        { text: 'Execute cross-region automated failover chaos drill', checked: false },
      ]),
    ]);

    // 7. Syntax-Highlighted Code Block
    frag.insert(frag.length, [createH(2, 'Verification CLI Command')]);
    frag.insert(frag.length, [
      createCode(
`# Query platform health and audit hash chain integrity
curl -sSf -H "Authorization: Bearer $SYSTEM_PAT" \\
  https://glyphroom.corp.internal/api/v1/audit/verify | jq .`,
        'bash'
      ),
    ]);

    // 8. File Attachment Block
    frag.insert(frag.length, [createH(2, 'Architecture Whitepaper Attachment')]);
    frag.insert(frag.length, [
      createAttachment({
        attachmentId: sampleAttId1,
        fileName: 'enterprise_crdt_architecture_spec_v2.pdf',
        fileSize: sampleFile1.size,
        mimeType: 'application/pdf',
        url: `/api/v1/attachments/${sampleAttId1}`,
        scanStatus: 'clean',
      }),
    ]);
  });

  // Upsert Post 1
  const slug1 = 'global-platform-architecture-status';
  await db.delete(posts).where(eq(posts.slug, slug1));
  const [post1] = await db
    .insert(posts)
    .values({
      title: 'Global Platform Architecture & High-Availability Status',
      slug: slug1,
      excerpt: 'Executive architectural overview, live CRDT sequence diagram, mathematical SLO model, and multi-region cluster health matrix.',
      status: 'published',
      authorId: adminId,
      coeId: archCoeId,
      yjsState: post1Data.yjsState,
      workingMarkdown: post1Data.markdown,
      publishedMarkdown: post1Data.markdown,
      publishedAt: new Date(),
    })
    .returning();

  // Insert attachment record
  await db.insert(postAttachments).values({
    id: sampleAttId1,
    postId: post1.id,
    fileName: 'enterprise_crdt_architecture_spec_v2.pdf',
    fileSize: sampleFile1.size,
    mimeType: 'application/pdf',
    sha256: sampleFile1.sha256,
    storagePath: sampleFile1.storagePath,
    scanStatus: 'clean',
    uploadedBy: adminId,
  });

  // Insert view count and version
  await db.insert(postViewCounts).values({ postId: post1.id, totalViews: 1420n });
  await db.insert(postVersions).values({
    postId: post1.id,
    versionNumber: 1,
    triggerReason: 'publication',
    yjsStateSnapshot: post1Data.yjsState,
    markdownSnapshot: post1Data.markdown,
    createdBy: adminId,
  });

  console.log(`✅ Created Post 1 (Admin Author): "${post1.title}" (${post1.slug})`);

  // =========================================================================
  // POST 2: Authored by NEW USER (Elena Rostova - Staff SRE)
  // Status: in_review
  // =========================================================================
  const elenaId = userMap.get('elena.rostova@enterprise.internal')!;
  const sreCoeId = coeMap.get('SRE')!;

  const sampleFile2 = await createSampleAttachmentFile(
    '10k_op_convergence_benchmark_log.zip',
    'PK\x03\x04Mock benchmark raw metrics and telemetry capture zip payload.'
  );
  const sampleAttId2 = crypto.randomUUID();

  const post2Data = buildRichYDoc((frag) => {
    frag.insert(frag.length, [createH(1, 'High-Throughput CRDT Ingestion Engine RFC & Fuzz Benchmarks')]);
    frag.insert(frag.length, [
      createP(
        'Proposal to optimize Hocuspocus CRDT ingestion under burst traffic, incorporating memory backpressure buffers and Myers diff suggestion clustering.'
      ),
    ]);

    // 1. Status Block (Amber status)
    frag.insert(frag.length, [
      createStatusBlock({
        ragStatus: 'amber',
        milestoneTitle: '10,000-Op Headless Convergence Testing',
        completionPercent: 68,
        targetDate: '2026-12-01',
        blockers: 'Backpressure queue memory threshold tuning under 20% simulated network drop',
      }),
    ]);

    // 2. Alert Callouts
    frag.insert(frag.length, [
      createAlert('warning', 'Notice: Testing under degraded network partitions requires running the headless test pool with deterministic PRNG seeds.'),
    ]);

    // 3. Live Mermaid Flowchart Diagram
    frag.insert(frag.length, [createH(2, 'Ingestion Pipeline & Backpressure Flow')]);
    frag.insert(frag.length, [
      createMermaid(
`flowchart TD
    A[Incoming Edits 10k/sec] --> B[Backpressure Ring Buffer]
    B --> C{CRC32 Valid?}
    C -->|Valid| D[In-Process Yjs Document Worker]
    C -->|Corrupt| E[Drop Delta & Request Resync]
    D --> F[Memory State Cache]
    F --> G[(PostgreSQL BYTEA Storage)]`
      ),
    ]);

    // 4. KaTeX Math Formula
    frag.insert(frag.length, [createH(2, 'Mathematical Convergence Complexity Model')]);
    frag.insert(frag.length, [
      createMath('\\Theta(n) = \\sum_{k=1}^N \\left( \\frac{\\Delta \\text{size}_k}{\\Delta t_k} \\right) \\cdot \\log_2(k) + \\sigma_{\\text{jitter}}'),
    ]);

    // 5. Real Data Table
    frag.insert(frag.length, [createH(2, 'Convergence Stress Test Results')]);
    frag.insert(frag.length, [
      createTable(
        ['Suite ID', 'Clients', 'Operations', 'Network Condition', 'Convergence Time', 'Outcome'],
        [
          ['FZZ-01', '5 Human + 1 Agent', '10,000 ops', 'Clean (0ms delay)', '320 ms', 'PASS (0 div)'],
          ['FZZ-02', '10 Parallel Peers', '25,000 ops', '15% drops, 20% reorder', '840 ms', 'PASS (0 div)'],
          ['FZZ-03', 'Split-Brain Partition', '5,000 ops', 'Offline burst rejoin', '512 ms', 'PASS (0 div)'],
        ]
      ),
    ]);

    // 6. Interactive Task Checklist
    frag.insert(frag.length, [createH(2, 'Implementation Phases')]);
    frag.insert(frag.length, [
      createTaskList([
        { text: 'Profile V8 heap memory allocation during rapid Y.Doc instantiation', checked: true },
        { text: 'Implement transaction debounce timer with max-wait 2000ms flush threshold', checked: true },
        { text: 'Write stress test with 50 concurrent simulated WebSocket clients', checked: false },
      ]),
    ]);

    // 7. Syntax-Highlighted Code Block
    frag.insert(frag.length, [createH(2, 'TypeScript Convergence Validator')]);
    frag.insert(frag.length, [
      createCode(
`export async function assertConvergence(pool: ClientPool): Promise<void> {
  const states = await pool.collectEncodedStates();
  const baseline = states[0];
  const allIdentical = states.every(s => Buffer.compare(s, baseline) === 0);
  if (!allIdentical) throw new Error('CRDT state divergence detected across clients!');
}`,
        'typescript'
      ),
    ]);

    // 8. File Attachment Block
    frag.insert(frag.length, [createH(2, 'Raw Test Telemetry Archive')]);
    frag.insert(frag.length, [
      createAttachment({
        attachmentId: sampleAttId2,
        fileName: '10k_op_convergence_benchmark_log.zip',
        fileSize: sampleFile2.size,
        mimeType: 'application/zip',
        url: `/api/v1/attachments/${sampleAttId2}`,
        scanStatus: 'clean',
      }),
    ]);
  });

  // Upsert Post 2
  const slug2 = 'crdt-ingestion-engine-rfc';
  await db.delete(posts).where(eq(posts.slug, slug2));
  const [post2] = await db
    .insert(posts)
    .values({
      title: 'High-Throughput CRDT Ingestion Engine RFC & Fuzz Benchmarks',
      slug: slug2,
      excerpt: 'Comprehensive RFC proposing backpressure memory buffers, headless convergence harness data, and Myers diff clustering.',
      status: 'in_review',
      authorId: elenaId,
      coeId: sreCoeId,
      yjsState: post2Data.yjsState,
      workingMarkdown: post2Data.markdown,
    })
    .returning();

  await db.insert(postAttachments).values({
    id: sampleAttId2,
    postId: post2.id,
    fileName: '10k_op_convergence_benchmark_log.zip',
    fileSize: sampleFile2.size,
    mimeType: 'application/zip',
    sha256: sampleFile2.sha256,
    storagePath: sampleFile2.storagePath,
    scanStatus: 'clean',
    uploadedBy: elenaId,
  });

  await db.insert(postViewCounts).values({ postId: post2.id, totalViews: 380n });
  await db.insert(postVersions).values({
    postId: post2.id,
    versionNumber: 1,
    triggerReason: 'review_submission',
    yjsStateSnapshot: post2Data.yjsState,
    markdownSnapshot: post2Data.markdown,
    createdBy: elenaId,
  });

  console.log(`✅ Created Post 2 (New User Author: Elena): "${post2.title}" (${post2.slug})`);

  // =========================================================================
  // POST 3: Authored by MARCUS CHEN (Security Moderator)
  // Status: published
  // =========================================================================
  const marcusId = userMap.get('marcus.chen@enterprise.internal')!;
  const secCoeId = coeMap.get('SEC')!;

  const sampleFile3 = await createSampleAttachmentFile(
    'zero_trust_security_matrix.png',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
  );
  const sampleAttId3 = crypto.randomUUID();

  const post3Data = buildRichYDoc((frag) => {
    frag.insert(frag.length, [createH(1, 'Zero-Trust Content Security & Cryptographic Audit Chains')]);
    frag.insert(frag.length, [
      createP(
        'Standards for strict Content Security Policy (CSP), magic-byte file inspection, EXIF stripping, and cryptographic hash verification.'
      ),
    ]);

    // 1. Status Block
    frag.insert(frag.length, [
      createStatusBlock({
        ragStatus: 'green',
        milestoneTitle: 'SHA-256 Audit Hash Chain Verification',
        completionPercent: 100,
        targetDate: '2026-10-24',
        blockers: 'None — All cryptographic compliance tests passed',
      }),
    ]);

    // 2. Alert Callouts
    frag.insert(frag.length, [
      createAlert('caution', 'Critical: All mutating REST API endpoints strictly reject requests lacking the cryptographic x-csrf-token header with HTTP 403 Forbidden.'),
    ]);

    // 3. Live Mermaid Sequence Diagram
    frag.insert(frag.length, [createH(2, 'Cryptographic Audit Verification Flow')]);
    frag.insert(frag.length, [
      createMermaid(
`sequenceDiagram
    autonumber
    participant Auditor as SecOps Auditor
    participant API as Fastify API (/api/v1/audit/verify)
    participant Log as PostgreSQL Immutable Audit Log

    Auditor->>API: GET /api/v1/audit/verify (Admin Session)
    API->>Log: Stream rows ordered by created_at ASC
    Log-->>API: Stream [R0, R1, R2, ... Rn]
    loop For Every Row i
        API->>API: Compute expected_hash = SHA256(prev_hash + row_data)
        API->>API: Verify computed === row.row_hash
    end
    API-->>Auditor: 200 OK { valid: true, totalRows: 512 }`
      ),
    ]);

    // 4. KaTeX Math Formula
    frag.insert(frag.length, [createH(2, 'Cryptographic Hash Chaining Recurrence')]);
    frag.insert(frag.length, [
      createMath('H_i = \\mathcal{H}\\left( H_{i-1} \\parallel \\text{ActorID}_i \\parallel \\text{Action}_i \\parallel \\text{Timestamp}_i \\parallel \\text{Payload}_i \\right)'),
    ]);

    // 5. Real Data Table
    frag.insert(frag.length, [createH(2, 'Defensive Security Controls')]);
    frag.insert(frag.length, [
      createTable(
        ['Layer', 'Threat Vector', 'Mitigation Control', 'Enforcement Point'],
        [
          ['Uploads', 'Executable disguise (polyglots)', 'Magic-byte header inspection', 'Fastify Multipart Stream'],
          ['SVG / Mermaid', 'XSS Script Injection', 'DOMPurify Strict Sanitizer', 'Client-side NodeView Render'],
          ['State', 'Base64 CRDT payload bloat', 'allowBase64: false filter', 'TipTap Image Extension'],
          ['API', 'CSRF Attack', 'Cryptographic double-submit token', 'Fastify @fastify/csrf-protection'],
        ]
      ),
    ]);

    // 6. Interactive Task Checklist
    frag.insert(frag.length, [createH(2, 'Compliance Verification Checklist')]);
    frag.insert(frag.length, [
      createTaskList([
        { text: 'Verify EXIF metadata stripping on raster image uploads', checked: true },
        { text: 'Confirm Content-Disposition: attachment on non-image file serving', checked: true },
        { text: 'Audit admin break-glass authentication rate limiting', checked: true },
      ]),
    ]);

    // 7. Syntax-Highlighted Code Block
    frag.insert(frag.length, [createH(2, 'Audit Integrity Check Snippet')]);
    frag.insert(frag.length, [
      createCode(
`const isChainIntact = auditRows.every((row, idx) => {
  if (idx === 0) return row.prevHash === GENESIS_HASH;
  const expected = computeSha256(auditRows[idx - 1].rowHash + JSON.stringify(row.payload));
  return row.rowHash === expected;
});`,
        'typescript'
      ),
    ]);

    // 8. File Attachment Block
    frag.insert(frag.length, [createH(2, 'Security Control Matrix Diagram')]);
    frag.insert(frag.length, [
      createAttachment({
        attachmentId: sampleAttId3,
        fileName: 'zero_trust_security_matrix.png',
        fileSize: sampleFile3.size,
        mimeType: 'image/png',
        url: `/api/v1/attachments/${sampleAttId3}`,
        scanStatus: 'clean',
      }),
    ]);
  });

  // Upsert Post 3
  const slug3 = 'zero-trust-security-architecture';
  await db.delete(posts).where(eq(posts.slug, slug3));
  const [post3] = await db
    .insert(posts)
    .values({
      title: 'Zero-Trust Content Security & Cryptographic Audit Chains',
      slug: slug3,
      excerpt: 'Comprehensive security blueprint covering immutable SHA-256 audit chaining, magic-byte media inspection, and CSRF protection.',
      status: 'published',
      authorId: marcusId,
      coeId: secCoeId,
      yjsState: post3Data.yjsState,
      workingMarkdown: post3Data.markdown,
      publishedMarkdown: post3Data.markdown,
      publishedAt: new Date(),
    })
    .returning();

  await db.insert(postAttachments).values({
    id: sampleAttId3,
    postId: post3.id,
    fileName: 'zero_trust_security_matrix.png',
    fileSize: sampleFile3.size,
    mimeType: 'image/png',
    sha256: sampleFile3.sha256,
    storagePath: sampleFile3.storagePath,
    scanStatus: 'clean',
    uploadedBy: marcusId,
  });

  await db.insert(postViewCounts).values({ postId: post3.id, totalViews: 2150n });
  await db.insert(postVersions).values({
    postId: post3.id,
    versionNumber: 1,
    triggerReason: 'publication',
    yjsStateSnapshot: post3Data.yjsState,
    markdownSnapshot: post3Data.markdown,
    createdBy: marcusId,
  });

  console.log(`✅ Created Post 3 (Moderator Author: Marcus): "${post3.title}" (${post3.slug})`);

  // =========================================================================
  // POST 4: Authored by PRIYA SHARMA (Frontend Lead)
  // Status: draft
  // =========================================================================
  const priyaId = userMap.get('priya.sharma@enterprise.internal')!;
  const feCoeId = coeMap.get('FRONTEND')!;

  const post4Data = buildRichYDoc((frag) => {
    frag.insert(frag.length, [createH(1, 'Glyphroom Design System & Block View Engineering')]);
    frag.insert(frag.length, [
      createP(
        'Exploration of Warm Paper and Cool Slate typography, discrete foldable block cards, and awareness-guarded section reordering.'
      ),
    ]);

    // 1. Status Block
    frag.insert(frag.length, [
      createStatusBlock({
        ragStatus: 'green',
        milestoneTitle: 'Block View Card Layout & Collaborator Collision Guard',
        completionPercent: 85,
        targetDate: '2026-11-20',
        blockers: 'None — Polish smooth CSS elevation transitions',
      }),
    ]);

    // 2. Alert Callouts
    frag.insert(frag.length, [
      createAlert('tip', 'Tip: Block View enables authors to focus on discrete logical components without losing document-level formatting.'),
    ]);

    // 3. Live Mermaid Diagram
    frag.insert(frag.length, [createH(2, 'Design System Component Hierarchy')]);
    frag.insert(frag.length, [
      createMermaid(
`graph LR
    Canvas[Warm Paper Canvas #F6F5F2] --> Surface[Surface Card #FCFBF9]
    Surface --> Header[Card Type Header Tag]
    Surface --> Content[TipTap Rich Text Content]
    Surface --> Actions[Reorder Controls ▲ ▼]`
      ),
    ]);

    // 4. KaTeX Math Formula
    frag.insert(frag.length, [createH(2, 'WCAG 2.1 AAA Contrast Ratio Calculation')]);
    frag.insert(frag.length, [
      createMath('\\text{Contrast Ratio} = \\frac{L_1 + 0.05}{L_2 + 0.05} \\ge 7.0:1'),
    ]);

    // 5. Real Data Table
    frag.insert(frag.length, [createH(2, 'Design Token Palette Specification')]);
    frag.insert(frag.length, [
      createTable(
        ['Token Name', 'Warm Paper (Light)', 'Cool Slate (Dark)', 'Contrast Ratio', 'Usage'],
        [
          ['--canvas', '#F6F5F2', '#0F1216', '14.2:1', 'Main workspace background'],
          ['--surface', '#FCFBF9', '#161A20', '12.8:1', 'Card container background'],
          ['--accent', '#2F57C8', '#8FA8F2', '6.3:1', 'Interactive links and primary buttons'],
          ['--agent', '#6B46E0', '#A78BFA', '5.9:1', 'AI agent presence and suggestions'],
        ]
      ),
    ]);

    // 6. Interactive Task Checklist
    frag.insert(frag.length, [createH(2, 'Frontend Component Deliverables')]);
    frag.insert(frag.length, [
      createTaskList([
        { text: 'Implement single-button sidebar minimize anchored at the top', checked: true },
        { text: 'Add Post Deletion with confirmation modal to My Work and Post Settings', checked: true },
        { text: 'Build Block View control bar with active block type pills', checked: true },
        { text: 'Conduct cross-browser Safari & Firefox render verification', checked: false },
      ]),
    ]);

    // 7. Syntax-Highlighted Code Block
    frag.insert(frag.length, [createH(2, 'Tailwind Theme Token Integration')]);
    frag.insert(frag.length, [
      createCode(
`:root {
  --canvas: #F6F5F2;
  --surface: #FCFBF9;
  --border: 42 15.6% 87.5%;
  --accent: #2F57C8;
}

.dark {
  --canvas: #0F1216;
  --surface: #161A20;
  --border: 217.5 16% 19.6%;
  --accent: #8FA8F2;
}`,
        'css'
      ),
    ]);
  });

  // Upsert Post 4
  const slug4 = 'design-system-block-view-guide';
  await db.delete(posts).where(eq(posts.slug, slug4));
  const [post4] = await db
    .insert(posts)
    .values({
      title: 'Glyphroom Design System & Block View Engineering',
      slug: slug4,
      excerpt: 'Comprehensive engineering guide to Warm Paper & Cool Slate themes, Block View cards, and accessibility contrast standards.',
      status: 'draft',
      authorId: priyaId,
      coeId: feCoeId,
      yjsState: post4Data.yjsState,
      workingMarkdown: post4Data.markdown,
    })
    .returning();

  await db.insert(postViewCounts).values({ postId: post4.id, totalViews: 120n });

  console.log(`✅ Created Post 4 (Author: Priya - Draft): "${post4.title}" (${post4.slug})`);

  // 5. Append audit logs for all seed events
  await auditServiceSafe(db, adminId, 'posts_seed_completed', {
    totalPostsCreated: 4,
    authors: [
      'admin@enterprise-blogger.local',
      'elena.rostova@enterprise.internal',
      'marcus.chen@enterprise.internal',
      'priya.sharma@enterprise.internal',
    ],
  });

  console.log('🎉 Successfully seeded all rich dummy posts across admin and user roles!');
  await close();
}

async function auditServiceSafe(db: any, actorUserId: string, action: string, metadata: any) {
  try {
    const [latest] = await db.select({ rowHash: auditLogs.rowHash }).from(auditLogs).orderBy(auditLogs.createdAt).limit(1);
    const prevHash = latest?.rowHash || '0'.repeat(64);
    const rowHash = crypto.createHash('sha256').update(prevHash + action + JSON.stringify(metadata)).digest('hex');

    await db.insert(auditLogs).values({
      actorUserId,
      actorType: 'system',
      action,
      entityType: 'post',
      prevHash,
      rowHash,
      metadata,
    });
  } catch (err) {
    // Ignore audit insert errors during dev seed
  }
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
