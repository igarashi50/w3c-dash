const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve, ms)); }

// timeoutMs: how long to wait for a slow response (ms)
function fetchJson(url, retries = 6, backoffMs = 60000, timeoutMs = 180000, redirects = 5) {
  return new Promise((resolve, reject) => {
    try {
      const target = new URL(url);
      const lib = target.protocol === 'http:' ? http : https;
      const headers = {
        // User-Agent を送らない（元の動作に戻す）
        'Accept': 'application/json, text/*;q=0.1',
        'Accept-Encoding': 'gzip,deflate',
        'Connection': 'close'
      };

      const req = lib.get(url, { headers, timeout: timeoutMs }, res => {
        // handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && redirects > 0 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchJson(next, retries, backoffMs, timeoutMs, redirects - 1));
        }

        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', async () => {
          // handle errors/status
          if (res.statusCode >= 400) {
            if (res.statusCode === 429 && retries > 0) {
              const ra = parseInt(res.headers['retry-after'], 10);
              const waitMs = Number.isFinite(ra) ? ra * 1000 : backoffMs;
              console.warn(`429 for ${url}, wait ${waitMs}ms (${retries-1} retries left)`);
              await new Promise(r => setTimeout(r, waitMs));
              return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects).then(resolve).catch(reject);
            }
            return reject(new Error(`${res.statusCode} ${url}`));
          }

          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();

          const finish = (buf) => {
            try {
              const text = buf.toString('utf8');
              return resolve(JSON.parse(text));
            } catch (e) {
              return reject(e);
            }
          };

          if (enc === 'gzip') {
            zlib.gunzip(raw, (err, out) => err ? reject(err) : finish(out));
          } else if (enc === 'deflate') {
            zlib.inflate(raw, (err, out) => err ? reject(err) : finish(out));
          } else {
            finish(raw);
          }
        });
      });

      req.on('error', async (err) => {
        // network error: retry with backoff if allowed
        if (retries > 0) {
          const wait = backoffMs;
          console.warn(`request error for ${url}: ${err.message}. retrying after ${wait}ms (${retries-1} left)`);
          await new Promise(r => setTimeout(r, wait));
          return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects).then(resolve).catch(reject);
        }
        reject(err);
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`timeout ${timeoutMs}ms for ${url}`));
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchPages(startUrl) {
  const out = [];
  if (!startUrl) return out;
  let url = startUrl;
  while (url) {
    console.warn(`request for ${url}`);
    try {
      const r = await fetchJson(url, 6, 60000, 120000);
      out.push(r);
    } catch (e) {
      console.warn(`error fetching ${url}: ${e.message}, skipping`);
      out.push({ _error: String(e), _url: url });
    }
    url = out[out.length - 1]?._links?.next?.href || null;
    if (url) await sleep(1000);
  }
  return out;
}

async function fetchParticipationDetailsFromPages(pages, delayMs = 900) {
  const details = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const items = Array.isArray(page) ? page : (page._links?.participations || []);
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      const href = it?.href || it?.url || null;
      if (!href) continue;
      try {
        const d = await fetchJson(href, 6, 60000, 120000);
        details.push(d);
      } catch (e) {
        console.warn(`error fetching participation ${href}: ${e.message}, skipping`);
        details.push({ _error: String(e), _url: href });
      }
      await sleep(delayMs);
    }
    await sleep(600);
  }
  return details;
}

async function main() {
  fs.mkdirSync('data', { recursive: true });
  const outputFile = 'data/wg_ig_participants.json';
  
  // Initialize or clear output file with array start
  fs.writeFileSync(outputFile, '{\n  "fetchedAt": "' + new Date().toISOString() + '",\n  "groups": [\n', 'utf8');

  let wg, ig, groups;
  try {
    wg = await fetchJson('https://api.w3.org/groups/wg');
    ig = await fetchJson('https://api.w3.org/groups/ig');
    groups = [...(wg._links?.groups || []), ...(ig._links?.groups || [])];
    console.log(`Fetched ${groups.length} groups`);
  } catch (e) {
    console.error(`Failed to fetch groups: ${e.message}`);
    process.exit(1);
  }

  let processedCount = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const groupName = g.title || g.name || g.id || 'unknown';
    console.log(`[${i+1}/${groups.length}] Processing: ${groupName}`);

    try {
      await sleep(400);

      const partHref = g._links?.participations?.href || (g.href ? g.href.replace(/\/$/, '') + '/participations' : null);
      const usersHref = g._links?.users?.href || (g.href ? g.href.replace(/\/$/, '') + '/users' : null);

      let participationsPages = [];
      let usersPages = [];
      let participationDetails = [];

      try {
        participationsPages = await fetchPages(partHref);
      } catch (e) {
        console.warn(`  error fetching participations: ${e.message}`);
      }

      try {
        usersPages = await fetchPages(usersHref);
      } catch (e) {
        console.warn(`  error fetching users: ${e.message}`);
      }

      try {
        participationDetails = await fetchParticipationDetailsFromPages(participationsPages, 900);
      } catch (e) {
        console.warn(`  error fetching participation details: ${e.message}`);
      }

      const groupRecord = {
        groupRaw: g,
        participationsPagesRaw: participationsPages,
        usersPagesRaw: usersPages,
        participationDetailsRaw: participationDetails
      };

      // Append to file (not last item yet)
      if (processedCount > 0) {
        fs.appendFileSync(outputFile, ',\n', 'utf8');
      }
      fs.appendFileSync(outputFile, JSON.stringify(groupRecord, null, 2), 'utf8');
      processedCount++;

      await sleep(800);
    } catch (e) {
      console.error(`  Unexpected error processing group ${groupName}: ${e.message}`);
      // continue to next group
    }
  }

  // Close JSON
  fs.appendFileSync(outputFile, '\n  ]\n}\n', 'utf8');
  console.log(`\nCompleted! Processed ${processedCount}/${groups.length} groups`);
  console.log(`Output: ${outputFile}`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });