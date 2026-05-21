import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import GIFEncoder from 'gif-encoder-2';
import { createWriteStream, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'docs', 'demo.gif');
const WIDTH = 800;
const HEIGHT = 640;

// ── GitHub-like styles ──────────────────────────────────────────────

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
    Helvetica, Arial, sans-serif;
  background: #f6f8fa;
  color: #1f2328;
  font-size: 14px;
  line-height: 1.5;
}
.page { max-width: ${WIDTH}px; margin: 0 auto; }

/* ── Header ── */
.header {
  background: #24292f;
  color: #fff;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.octicon { display: inline-flex; }
.octicon svg { width: 20px; height: 20px; fill: #fff; }
.repo-breadcrumb { font-size: 14px; color: #f0f6fc; }
.repo-breadcrumb a { color: #f0f6fc; text-decoration: none; font-weight: 600; }
.repo-breadcrumb .sep { color: #484f58; margin: 0 4px; }

/* ── Issue title ── */
.title-section {
  background: #fff;
  padding: 20px 24px;
  border-bottom: 1px solid #d0d7de;
}
.title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 4px;
}
.badge-open { background: #dafbe1; color: #1a7f37; }
.badge-open svg { width: 14px; height: 14px; fill: #1a7f37; }
.issue-title { font-size: 22px; font-weight: 600; color: #1f2328; }
.issue-num { font-size: 22px; font-weight: 300; color: #656d76; margin-left: 6px; }
.issue-meta {
  font-size: 12px;
  color: #656d76;
  margin-top: 6px;
  padding-left: 34px;
}
.issue-meta a { color: #0969da; text-decoration: none; font-weight: 500; }

/* ── Labels ── */
.labels {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-left: 34px;
}
.label-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  border: 1px solid transparent;
}
.label-bug { background: #ffebe9; color: #82071e; border-color: rgba(255,129,130,0.4); }
.label-pri { background: #fff8c5; color: #9a6700; border-color: rgba(227,179,65,0.4); }

/* ── Timeline items ── */
.timeline-item {
  display: flex;
  gap: 16px;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #d0d7de;
}
.avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.avatar-user { background: #ddf4ff; color: #0969da; }
.avatar-bot { background: #fbefff; font-size: 16px; }
.timeline-content { flex: 1; min-width: 0; }
.timeline-header { font-size: 13px; color: #656d76; margin-bottom: 8px; }
.timeline-header .author { font-weight: 600; color: #1f2328; }
.timeline-body { color: #1f2328; }
.timeline-body p + p { margin-top: 6px; }
.timeline-body code {
  background: #eff1f3;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.timeline-body ul { padding-left: 20px; margin-top: 6px; }
.timeline-body li { margin-bottom: 2px; }
.timeline-body strong { font-weight: 600; }

/* ── Typing indicator ── */
.typing-dots { display: flex; gap: 5px; padding: 8px 0; }
.typing-dots span {
  width: 8px; height: 8px;
  background: #656d76; border-radius: 50%;
}
.typing-dots span:nth-child(1) { opacity: 0.3; }
.typing-dots span:nth-child(2) { opacity: 0.6; }
.typing-dots span:nth-child(3) { opacity: 1.0; }

/* ── Comment box placeholder ── */
.comment-placeholder {
  background: #fff;
  padding: 16px 24px;
}
.comment-box {
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 10px 14px;
  color: #8b949e;
  font-size: 14px;
  min-height: 36px;
}

/* ── Animations ── */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.fade-in { animation: fadeIn 0.3s ease-in; }
`;

// ── SVG icons ───────────────────────────────────────────────────────

const GITHUB_OCTICON = `<span class="octicon"><svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></span>`;

const OPEN_ICON = `<svg viewBox="0 0 16 16"><path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/><path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/></svg>`;

// ── HTML builders ───────────────────────────────────────────────────

function header() {
  return `<div class="header">
    ${GITHUB_OCTICON}
    <span class="repo-breadcrumb">
      <a href="#">example</a><span class="sep">/</span><a href="#">project</a>
    </span>
  </div>`;
}

function titleSection(labels) {
  return `<div class="title-section">
    <div class="title-row">
      <span class="badge badge-open">${OPEN_ICON} Open</span>
      <span class="issue-title">Login page crashes on Chrome 120</span>
      <span class="issue-num">#42</span>
    </div>
    <div class="issue-meta">
      <a href="#">user123</a> opened this issue 2 minutes ago &middot; 0 comments
    </div>
    ${labels ? `<div class="labels">${labels}</div>` : ''}
  </div>`;
}

function issueBody() {
  return `<div class="timeline-item">
    <div class="avatar avatar-user">U</div>
    <div class="timeline-content">
      <div class="timeline-header">
        <span class="author">user123</span> opened this issue 2 minutes ago
      </div>
      <div class="timeline-body">
        <p>When I click the login button on Chrome 120, the page goes blank.</p>
        <p>This only happens after the latest deploy. Steps to reproduce:</p>
        <p>1. Navigate to <code>/login</code><br>
           2. Enter credentials<br>
           3. Click &quot;Sign In&quot;<br>
           4. Page goes completely blank</p>
      </div>
    </div>
  </div>`;
}

function typingIndicator() {
  return `<div class="timeline-item fade-in">
    <div class="avatar avatar-bot">\u{1F916}</div>
    <div class="timeline-content">
      <div class="timeline-header">
        <span class="author">issue-ai-agent[bot]</span> is analyzing&hellip;
      </div>
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>`;
}

function botReply() {
  return `<div class="timeline-item fade-in">
    <div class="avatar avatar-bot">\u{1F916}</div>
    <div class="timeline-content">
      <div class="timeline-header">
        <span class="author">issue-ai-agent[bot]</span> commented just now
      </div>
      <div class="timeline-body">
        <p>Thanks for reporting! I've classified this issue:</p>
        <p><strong>Category:</strong> bug &nbsp;&middot;&nbsp; <strong>Priority:</strong> high</p>
        <p>To help us reproduce this crash, could you provide:</p>
        <ul>
          <li>Chrome version and operating system</li>
          <li>Any console error messages</li>
          <li>A screenshot of the blank page</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function commentBox() {
  return `<div class="comment-placeholder">
    <div class="comment-box">Write a comment&hellip;</div>
  </div>`;
}

function pageHTML(body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="page">${header()}${body}${commentBox()}</div></body></html>`;
}

// ── Frame definitions ───────────────────────────────────────────────

const LABELS_HTML = `
  <span class="label-pill label-bug">bug</span>
  <span class="label-pill label-pri">priority: high</span>
`;

const frames = [
  {
    html: pageHTML(titleSection('') + issueBody()),
    delay: 2000,  // 2s — show the initial issue
  },
  {
    html: pageHTML(titleSection(LABELS_HTML) + issueBody() + typingIndicator()),
    delay: 1500,  // 1.5s — labels appear, bot is processing
  },
  {
    html: pageHTML(titleSection(LABELS_HTML) + issueBody() + botReply()),
    delay: 4000,  // 4s — final state with bot reply
  },
];

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  console.log('Capturing frames...');
  const screenshots = [];
  for (let i = 0; i < frames.length; i++) {
    await page.setContent(frames[i].html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    screenshots.push({ buf, delay: frames[i].delay });
    console.log(`  Frame ${i + 1}/${frames.length} captured`);
  }

  await browser.close();

  // Encode GIF
  console.log('Encoding GIF...');
  const encoder = new GIFEncoder(WIDTH, HEIGHT, 'neuquant', true);
  const stream = createWriteStream(OUTPUT_PATH);
  encoder.createReadStream().pipe(stream);

  encoder.start();
  encoder.setRepeat(0);   // infinite loop
  encoder.setQuality(10); // 1-20, lower = better

  for (const { buf, delay } of screenshots) {
    const png = PNG.sync.read(buf);
    encoder.setDelay(delay);
    encoder.addFrame(png.data);
  }

  encoder.finish();

  // Wait for stream to finish
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const stats = statSync(OUTPUT_PATH);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`\nDone! ${OUTPUT_PATH} (${sizeKB} KB)`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
