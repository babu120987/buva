import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const origin = 'https://buva.shop';
const pages = ['index', 'service', 'about', 'team', 'testimonial', 'contact'];
const pageUrl = (page) => page === 'index' ? `${origin}/` : `${origin}/${page}.html`;
const sitemapPath = path.join(frontend, 'sitemap.xml');
const sync = process.argv.includes('--sync-sitemap');
const catalogFileIndex = process.argv.indexOf('--catalog-file');
const catalogFile = catalogFileIndex < 0 ? null : process.argv[catalogFileIndex + 1];
const live = sync || process.argv.includes('--live') || Boolean(catalogFile);

const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const meta = (html, key, value) => {
  const tag = html.match(/<meta\b[^>]*>/gi)?.find((item) => attribute(item, key) === value);
  return tag && attribute(tag, 'content');
};
const canonical = (html) => {
  const tag = html.match(/<link\b[^>]*>/gi)?.find((item) => attribute(item, 'rel') === 'canonical');
  return tag && attribute(tag, 'href');
};
const sitemapUrls = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const productUrl = (slug) => `${origin}/product.html?slug=${encodeURIComponent(slug)}`;

let products = [];
if (live) {
  let payload;
  if (catalogFile) {
    payload = JSON.parse(await readFile(catalogFile, 'utf8'));
  } else {
    const response = await fetch(`${origin}/api/products?limit=100`, { headers: { Accept: 'application/json' } });
    assert(response.ok, `Catalog API returned HTTP ${response.status}`);
    payload = await response.json();
  }
  products = payload.products;
  assert(Array.isArray(products), 'Catalog API did not return products');
  assert(products.length < 100, 'Catalog may be truncated at 100 products; paginate before syncing');
  assert(products.every((product) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) && product.name), 'Catalog has an invalid slug or missing name');
  for (const product of products) {
    const missing = ['shortDescription', 'imageUrl', 'imageAlt'].filter((field) => !product[field]);
    if (missing.length) console.warn(`Product ${product.slug}: missing ${missing.join(', ')}`);
    if (product.pricePaise < 10000) console.warn(`Product ${product.slug}: price below ₹100; verify this is intentional`);
  }
}

if (sync) {
  const urls = [...pages.map(pageUrl), ...products.map((product) => productUrl(product.slug))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(sitemapPath, xml);
  console.log(`Updated sitemap with ${products.length} live products.`);
}

const titles = new Set();
const descriptions = new Set();
for (const page of pages) {
  const html = await readFile(path.join(frontend, `${page}.html`), 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = meta(html, 'name', 'description');
  assert(title && !titles.has(title), `${page}: missing or duplicate title`);
  assert(description && !descriptions.has(description), `${page}: missing or duplicate description`);
  assert(canonical(html) === pageUrl(page), `${page}: wrong canonical`);
  assert(meta(html, 'property', 'og:url') === pageUrl(page), `${page}: wrong Open Graph URL`);
  assert(!/noindex|name="keywords"/i.test(html), `${page}: unexpected noindex or meta keywords`);
  assert((html.match(/<h1\b/gi) || []).length === 1, `${page}: expected one H1`);
  titles.add(title);
  descriptions.add(description);
}

const home = await readFile(path.join(frontend, 'index.html'), 'utf8');
const graph = JSON.parse(home.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1] || 'null')?.['@graph'];
assert(graph?.some((item) => item['@type'] === 'Organization' && item.name === 'BUVA' && item.url === `${origin}/`), 'Homepage Organization data missing');
assert(graph?.some((item) => item['@type'] === 'WebSite' && item.name === 'BUVA' && item.url === `${origin}/`), 'Homepage WebSite data missing');
const robots = await readFile(path.join(frontend, 'robots.txt'), 'utf8');
assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'robots.txt has the wrong sitemap');
const urls = sitemapUrls(await readFile(sitemapPath, 'utf8'));
assert(urls.length === new Set(urls).size, 'Sitemap has duplicate URLs');
for (const url of pages.map(pageUrl)) assert(urls.includes(url), `Sitemap is missing ${url}`);
if (live) for (const product of products) assert(urls.includes(productUrl(product.slug)), `Sitemap is missing ${product.name} (${product.slug})`);
console.log(`SEO audit passed: ${pages.length} pages, ${urls.length} sitemap URLs${live ? `, ${products.length} live products` : ''}.`);
