// node generate-pages.js
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'dist'); // folder build final
if(!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function slugify(text){
  return String(text||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');
}

const indexJson = JSON.parse(fs.readFileSync(path.join(__dirname,'index.json'), 'utf8'));

// indexJson can be array of file paths or array of items. adapt si bezwen:
const items = Array.isArray(indexJson) ? indexJson : (indexJson.items||[]);

items.forEach((it, i) => {
  const title = it.Titre || it.Name || it.title || ('item-' + i);
  const desc = (it.Description || it.Bio || '').slice(0,160);
  const slug = it.__slug || slugify(title) || ('item-'+i);
  const thumb = it['Url Thumb'] || it.thumb || '';

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(desc)}">
<link rel="canonical" href="https://tf-stream.pages.dev/${slug}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(desc)}">
<meta property="og:url" content="https://tf-stream.pages.dev/${slug}">
<meta property="og:image" content="${escape(thumb)}">
<!-- JSON-LD for better indexing -->
<script type="application/ld+json">${JSON.stringify({
    "@context":"https://schema.org",
    "@type":"TVSeries",
    "name": title,
    "description": desc,
    "url": `https://tf-stream.pages.dev/${slug}`,
    "image": thumb || undefined
})}</script>
</head>
<body>
<!-- Minimal server-rendered content for crawlers -->
<h1>${escape(title)}</h1>
<p>${escape(desc)}</p>
<!-- SPA script can still boot here for full UI -->
<script src="/app.js" defer></script>
</body>
</html>`;

  const folder = path.join(outDir, slug);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder,'index.html'), html, 'utf8');
});

function escape(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      }
