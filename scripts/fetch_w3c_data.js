const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 2秒間隔 = 30 requests/min = 300 requests/10min (制限の5%使用)
const REQUEST_INTERVAL = 2000;

let collectedData = []; // メモリ上にデータを蓄積
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）

function addToCollection(url, data) {
  collectedData.push({
    url: url,
    fetchedAt: new Date().toISOString(),
    data: data
  });
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h${minutes % 60}m${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function compareAndWriteJson() {
  // 所要時間を計算
  const duration = Date.now() - fetchStartTimestamp;
  const durationStr = formatDuration(duration);
  
  const datedFile = `data/w3c_api_${fetchStartTime}_${durationStr}.json`;
  const symlinkPath = 'data/w3c_api.json';
  
  const newContent = JSON.stringify(collectedData, null, 2);
  
  // 既存のw3c_api.jsonと比較
  let hasChanges = true;
  if (fs.existsSync(symlinkPath)) {
    try {
      const existingContent = fs.readFileSync(symlinkPath, 'utf8');
      const existingData = JSON.parse(existingContent);
      const newData = JSON.parse(newContent);
      
      // データの比較（fetchedAt を除外して比較）
      const existingDataWithoutTimestamp = existingData.map(item => ({ url: item.url, data: item.data }));
      const newDataWithoutTimestamp = newData.map(item => ({ url: item.url, data: item.data }));
      
      if (JSON.stringify(existingDataWithoutTimestamp) === JSON.stringify(newDataWithoutTimestamp)) {
        hasChanges = false;
        console.log('\n✓ No changes detected. Skipping file write.');
        return false;
      }
    } catch (e) {
      console.warn(`Warning: Could not compare with existing file: ${e.message}`);
      hasChanges = true;
    }
  }
  
  if (hasChanges) {
    // 日付時刻＋所要時間入りファイルに書き込み
    fs.writeFileSync(datedFile, newContent, 'utf8');
    console.log(`\n✓ Data written to: ${datedFile}`);
    
    // シンボリックリンクを作成
    try {
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
      
      const relativePath = `w3c_api_${fetchStartTime}_${durationStr}.json`;
      fs.symlinkSync(relativePath, symlinkPath);
      console.log(`✓ Created symlink: ${symlinkPath} -> ${relativePath}`);
    } catch (e) {
      console.error(`Failed to create symlink: ${e.message}`);
    }
    
    return true;
  }
  
  return false;
}

function fetchJson(url, retries = 6, backoffMs = 5000, timeoutMs = 180000, redirects = 5) {
  return new Promise((resolve, reject) => {
    try {
      const target = new URL(url);
      const lib = target.protocol === 'http:' ? http : https;
      const headers = {
        'Accept': 'application/json, text/*;q=0.1',
        'Accept-Encoding': 'gzip,deflate',
        'Connection': 'close'
      };

      const req = lib.get(url, { headers, timeout: timeoutMs }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && redirects > 0 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchJson(next, retries, backoffMs, timeoutMs, redirects - 1));
        }

        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', async () => {
          if (res.statusCode >= 400) {
            if (res.statusCode === 429 && retries > 0) {
              const ra = parseInt(res.headers['retry-after'], 10);
              const waitMs = Number.isFinite(ra) ? ra * 1000 : backoffMs;
              console.warn(`429 for ${url}, wait ${waitMs}ms (${retries - 1} retries left)`);
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
              const data = JSON.parse(text);
              return resolve(data);
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
        if (retries > 0) {
          const wait = backoffMs;
          console.warn(`request error for ${url}: ${err.message}. retrying after ${wait}ms (${retries - 1} left)`);
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

async function fetchData(startUrl) {
  if (!startUrl) return [];
  
  const pages = [];
  let url = startUrl;
  
  // すべてのページを取得
  while (url) {
    console.warn(`request for ${url}`);
    try {
      const r = await fetchJson(url, 6, 5000, 120000);
      pages.push(r);
      url = r?._links?.next?.href || null;
      if (url) await sleep(REQUEST_INTERVAL);
    } catch (e) {
      console.warn(`error fetching ${url}: ${e.message}, skipping`);
      const errObj = { error: String(e) };
      pages.push(errObj);
      break;
    }
  }
  
  // ページが1つだけの場合、コレクションに追加
  if (pages.length === 1) {
    addToCollection(startUrl, pages[0]);
    return pages;
  }
  
  // 複数ページの場合、マージして1つのページ形式にする
  if (pages.length > 1) {
    const merged = {
      page: 1,
      limit: 0,
      pages: 1,
      total: 0,
      _links: {}
    };
    
    // 各ページからデータを集約
    const allItems = [];
    let dataKey = null;
    
    for (const page of pages) {
      if (page.error) continue;
      
      if (!dataKey && page._links) {
        for (const key of Object.keys(page._links)) {
          if (Array.isArray(page._links[key])) {
            dataKey = key;
            break;
          }
        }
      }
      
      if (dataKey && page._links && Array.isArray(page._links[dataKey])) {
        allItems.push(...page._links[dataKey]);
      }
      
      if (page._links) {
        if (page._links.up && !merged._links.up) {
          merged._links.up = page._links.up;
        }
      }
    }
    
    merged.total = allItems.length;
    merged.limit = allItems.length;
    
    if (dataKey) {
      merged._links[dataKey] = allItems;
    }
    
    merged._links.self = { href: startUrl };
    merged._links.first = { href: startUrl };
    merged._links.last = { href: startUrl };
    
    addToCollection(startUrl, merged);
    return [merged];
  }
  
  return pages;
}

async function processGroupCategory(categoryUrl) {
  const categoryName = categoryUrl.includes('/wg') ? 'WG' : 'IG';
  console.log(`\n========== Processing ${categoryName} ==========`);
  
  try {
    const categoryResp = await fetchJson(categoryUrl, 6, 5000, 120000);
    addToCollection(categoryUrl, categoryResp);
    console.log(`✓ Fetched ${categoryName} list`);
    
    const groups = categoryResp._links?.groups || [];
    console.log(`Found ${groups.length} ${categoryName} groups\n`);

    let processedCount = 0;
    for (let i = 0; i < groups.length; i++) {
      if (i == 1) break; // --- TESTING LIMIT ---
      const g = groups[i];
      const groupName = g.title || g.name || g.id || 'unknown';
      console.log(`[${i + 1}/${groups.length}] Processing: ${groupName}`);

      try {
        const partHref = g._links?.participations?.href || (g.href ? g.href.replace(/\/$/, '') + '/participations' : null);
        const usersHref = g._links?.users?.href || (g.href ? g.href.replace(/\/$/, '') + '/users' : null);

        // Fetch all participations pages
        if (partHref) {
          console.log(`  → Fetching participations pages from ${partHref}`);
          const participationsPages = await fetchData(partHref);
          console.log(`    ✓ Fetched and merged participations (${participationsPages.length} page(s) merged)`);

          // Fetch each participation detail
          for (const page of participationsPages) {
            const items = Array.isArray(page) ? page : (page._links?.participations || []);
            for (const it of items) {
              const href = it?.href || it?.url || null;
              if (!href) continue;
              try {
                await sleep(REQUEST_INTERVAL);
                console.log(`    → Fetching participation detail: ${href}`);
                const detailPages = await fetchData(href);
                console.log(`      ✓ Fetched ${detailPages.length} page(s)`);
              } catch (e) {
                console.warn(`    error fetching participation ${href}: ${e.message}, skipping`);
              }
            }
          }
        }

        // Fetch all users pages
        if (usersHref) {
          await sleep(REQUEST_INTERVAL);
          console.log(`  → Fetching users pages from ${usersHref}`);
          const usersPages = await fetchData(usersHref);
          console.log(`    ✓ Fetched and merged users (${usersPages.length} page(s) merged)`);
        }

        processedCount++;
      } catch (e) {
        console.error(`  Unexpected error processing group ${groupName}: ${e.message}`);
      }
    }

    console.log(`✓ Completed ${categoryName}: Processed ${processedCount}/${groups.length} groups`);
  } catch (e) {
    console.error(`Failed to fetch ${categoryName}: ${e.message}`);
  }
}

async function main() {
  // 取得開始時刻を記録
  fetchStartTimestamp = Date.now();
  const now = new Date(fetchStartTimestamp);
  fetchStartTime = now.toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '-')
    .split('.')[0]; // 2025-11-29_13-45-30
  
  console.log(`Fetch started at: ${fetchStartTime}`);
  
  fs.mkdirSync('data', { recursive: true });

  // Process WG first
  //await processGroupCategory('https://api.w3.org/groups/wg');
  //await sleep(REQUEST_INTERVAL);

  // Then process IG
  await processGroupCategory('https://api.w3.org/groups/ig');

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== Done ==========`);
  console.log(`Total collected items: ${collectedData.length}`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  
  // 最後に比較して書き込み
  const written = compareAndWriteJson();
  
  if (written) {
    console.log('✓ Data successfully saved');
  }
}

main().catch(e => { 
  console.error('Fatal error:', e);
  process.exit(1); 
});