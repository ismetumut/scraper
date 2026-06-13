require('dotenv').config();

const { runCheck } = require('../src/services/connections-tracker');
const { todayString } = require('../src/utils/connections-store');
const { sendMail } = require('../src/utils/mailer');

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
  const { date, reports } = await runCheck();

  for (const r of reports) {
    if (r.error) {
      console.error(`  ❌ ${r.name}: ${r.error}`);
    } else {
      console.log(`  ✅ ${r.name}: toplam ${r.totalConnections}, ${r.newConnections.length} yeni`);
    }
  }

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
