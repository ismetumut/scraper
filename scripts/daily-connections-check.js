require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { scrapeConnections } = require('../src/services/connections-scraper');
const {
  slugify,
  todayString,
  saveSnapshot,
  loadPreviousSnapshot,
  diffConnections
} = require('../src/utils/connections-store');
const { sendMail } = require('../src/utils/mailer');
const { closeBrowser } = require('../src/services/browser');
const { humanDelay } = require('../src/utils/delay');

const TARGETS_FILE = path.join(__dirname, '..', 'config', 'connections-targets.json');

function loadTargets() {
  const raw = fs.readFileSync(TARGETS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function buildEmail(reports) {
  const date = todayString();
  const sections = reports.map(r => {
    if (r.error) {
      return `## ${r.name}\nHata: ${r.error}\n`;
    }
    if (r.newConnections.length === 0) {
      return `## ${r.name}\nYeni baglanti yok. (Toplam: ${r.totalConnections})\n`;
    }
    const lines = r.newConnections.map(c =>
      `- ${c.fullName}${c.headline ? ` - ${c.headline}` : ''}${c.profileUrl ? ` (${c.profileUrl})` : ''}`
    );
    return `## ${r.name} - ${r.newConnections.length} yeni baglanti\n${lines.join('\n')}\n`;
  });

  const text = `LinkedIn Baglanti Takip Raporu - ${date}\n\n${sections.join('\n')}`;

  const html = `<h2>LinkedIn Baglanti Takip Raporu - ${date}</h2>` +
    reports.map(r => {
      if (r.error) {
        return `<h3>${r.name}</h3><p>Hata: ${r.error}</p>`;
      }
      if (r.newConnections.length === 0) {
        return `<h3>${r.name}</h3><p>Yeni baglanti yok. (Toplam: ${r.totalConnections})</p>`;
      }
      const items = r.newConnections.map(c =>
        `<li><b>${c.fullName}</b>${c.headline ? ` - ${c.headline}` : ''}${c.profileUrl ? ` - <a href="${c.profileUrl}">profil</a>` : ''}</li>`
      ).join('');
      return `<h3>${r.name} - ${r.newConnections.length} yeni baglanti</h3><ul>${items}</ul>`;
    }).join('');

  return { text, html };
}

async function run() {
  const targets = loadTargets();
  const date = todayString();
  const reports = [];

  for (const target of targets) {
    const slug = slugify(target.name || target.profileUrl);
    console.log(`\n🔎 ${target.name} (${target.profileUrl})`);

    try {
      const { connections } = await scrapeConnections(target.profileUrl);
      const previous = loadPreviousSnapshot(slug, date);
      const newConnections = diffConnections(previous ? previous.connections : [], connections);

      saveSnapshot(slug, {
        date,
        profileUrl: target.profileUrl,
        scrapedAt: new Date().toISOString(),
        connections
      });

      reports.push({
        name: target.name,
        totalConnections: connections.length,
        newConnections
      });

      console.log(`  ✅ Toplam ${connections.length} baglanti, ${newConnections.length} yeni`);
    } catch (error) {
      console.error(`  ❌ Hata: ${error.message}`);
      reports.push({ name: target.name, error: error.message });
    }

    await humanDelay();
  }

  await closeBrowser();

  const { text, html } = buildEmail(reports);
  const to = process.env.NOTIFY_EMAIL;

  if (!to) {
    console.log('\nNOTIFY_EMAIL ayarlanmamis, e-posta gonderilmedi. Rapor:');
    console.log(text);
    return;
  }

  await sendMail({
    to,
    subject: `LinkedIn Baglanti Takip Raporu - ${date}`,
    text,
    html
  });

  console.log(`\n📧 Rapor ${to} adresine gonderildi.`);
}

run().catch(err => {
  console.error('Daily connections check failed:', err);
  process.exitCode = 1;
});
