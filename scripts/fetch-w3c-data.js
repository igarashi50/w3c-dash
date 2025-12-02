const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
const REQUEST_INTERVAL = 200;

let collectedData = {}; // メモリ上にデータを蓄積（Dictionary形式）
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）

function addToCollection(url, data) {
  collectedData[url] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };
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
  
  const datedFile = `data/w3c-groups-${fetchStartTime}-${durationStr}.json`;
  const groupDataPath = 'data/w3c-groups.json';
  
  const newContent = JSON.stringify(collectedData, null, 2);
  
  // 既存のw3c-groups.jsonと比較
  let hasChanges = true;
  if (fs.existsSync(groupDataPath)) {
    try {
      const existingContent = fs.readFileSync(groupDataPath, 'utf8');
      const existingData = JSON.parse(existingContent);
      const newData = JSON.parse(newContent);
      
      // データの比較（fetchedAt を除外して比較）
      const existingDataWithoutTimestamp = {};
      const newDataWithoutTimestamp = {};
      
      for (const url in existingData) {
        existingDataWithoutTimestamp[url] = existingData[url].data;
      }
      for (const url in newData) {
        newDataWithoutTimestamp[url] = newData[url].data;
      }
      
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
    
    // w3c-groups.json を最新ファイルのコピーとして作成（シンボリックリンクの代わり）
    try {
      // 既存のファイルを削除
      if (fs.existsSync(groupDataPath)) {
        fs.unlinkSync(groupDataPath);
      }
      
      // ファイルをコピー
      fs.copyFileSync(datedFile, groupDataPath);
      console.log(`✓ Copied to: ${groupDataPath}`);
    } catch (e) {
      console.error(`Failed to copy file: ${e.message}`);
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
  
  // グループタイプを抽出（例: /groups/wg, /groups/ig, /groups/cg など）
  const groupTypeMatch = startUrl.match(/\/groups\/(wg|ig|cg|tf|other)(?:\/|$)/);
  const groupType = groupTypeMatch ? groupTypeMatch[1] : null;
  
  // すべてのページを取得
  while (url) {
    console.warn(`request for ${url}`);
    try {
      const r = await fetchJson(url, 6, 5000, 120000);
      pages.push(r);
      url = r?._links?.next?.href || null;
      
      // nextリンクにグループタイプが含まれていない場合、追加する
      if (url && groupType && !url.includes(`/groups/${groupType}`)) {
        url = url.replace(/\/groups\?/, `/groups/${groupType}?`);
      }
      
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

async function processGroupType(typeUrl) {
  const typeMatch = typeUrl.match(/\/groups\/([^/?]+)/);
  const typeName = typeMatch ? typeMatch[1].toUpperCase() : 'UNKNOWN';
  console.log(`\n========== Processing ${typeName} ==========`);
  
  try {
    // Fetch all pages for this group type
    console.log(`Fetching ${typeName} list pages...`);
    const typePages = await fetchData(typeUrl);
    console.log(`✓ Fetched ${typeName} list (${typePages.length} page(s) merged)`);
    
    // Extract groups from the merged result
    const groups = typePages[0]?._links?.groups || [];
    console.log(`Found ${groups.length} ${typeName} groups\n`);

    let processedCount = 0;
    for (let i = 0; i < groups.length; i++) {
      // if (i >= 1) break; // --- TESTING LIMIT ---
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

    console.log(`✓ Completed ${typeName}: Processed ${processedCount}/${groups.length} groups`);
  } catch (e) {
    console.error(`Failed to fetch ${typeName}: ${e.message}`);
  }
}

async function main() {
  // 取得開始時刻を記録
  fetchStartTimestamp = Date.now();
  const now = new Date(fetchStartTimestamp);
  fetchStartTime = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/T/, '-')
    .split('.')[0]; // 20251202-044759
  
  console.log(`Fetch started at: ${fetchStartTime}`);
  
  fs.mkdirSync('data', { recursive: true });

  // Check for --test mode
  const isTestMode = process.argv.includes('--test');
  
  if (isTestMode) {
    console.log('Running in TEST mode - fetching only 5 sample groups\n');
    
    // Test with one group from each type
    const testGroups = [
      { type: 'wg', shortname: 'css' },
      { type: 'ig', shortname: 'i18n' },
      { type: 'cg', shortname: 'global-inclusion' },
      { type: 'tf', shortname: 'ab-elected' },
      { type: 'other', shortname: 'ab' }
    ];
    
    for (let i = 0; i < testGroups.length; i++) {
      const { type, shortname } = testGroups[i];
      const typeUrl = `https://api.w3.org/groups/${type}`;
      
      console.log(`\n========== Processing ${type.toUpperCase()} (test mode) ==========`);
      
      // Fetch the type list
      const typePages = await fetchData(typeUrl);
      const groups = typePages[0]?._links?.groups || [];
      console.log(`Found ${groups.length} ${type.toUpperCase()} groups (filtering for ${type}/${shortname})\n`);
      
      // Find the specific test group
      const testGroup = groups.find(g => g.href && g.href.includes(`/${type}/${shortname}`));
      
      if (testGroup) {
        const groupName = testGroup.title || testGroup.name || 'unknown';
        console.log(`[1/1] Processing: ${groupName}`);
        
        // Process this single group
        const groupHref = testGroup.href;
        
        try {
          const partHref = testGroup._links?.participations?.href || (groupHref ? groupHref.replace(/\/$/, '') + '/participations' : null);
          const usersHref = testGroup._links?.users?.href || (groupHref ? groupHref.replace(/\/$/, '') + '/users' : null);
          
          // Fetch group details
          await sleep(REQUEST_INTERVAL);
          await fetchData(groupHref);
          
          // Fetch participations
          if (partHref) {
            console.log(`  → Fetching participations pages from ${partHref}`);
            const participationsPages = await fetchData(partHref);
            console.log(`    ✓ Fetched and merged participations (${participationsPages.length} page(s) merged)`);
            
            // Fetch participation details
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
          
          // Fetch users
          if (usersHref) {
            await sleep(REQUEST_INTERVAL);
            console.log(`  → Fetching users pages from ${usersHref}`);
            const usersPages = await fetchData(usersHref);
            console.log(`    ✓ Fetched and merged users (${usersPages.length} page(s) merged)`);
          }
          
          console.log(`✓ Completed ${type.toUpperCase()}: Processed 1/1 groups`);
        } catch (e) {
          console.error(`  Unexpected error processing group ${groupName}: ${e.message}`);
        }
      } else {
        console.warn(`⚠ Test group ${type}/${shortname} not found`);
      }
      
      // Wait between types (except after the last one)
      if (i < testGroups.length - 1) {
        await sleep(REQUEST_INTERVAL);
      }
    }
  } else {
    // Process all group types
    const groupTypes = ['wg', 'ig', 'cg', 'tf', 'other'];
    
    for (let i = 0; i < groupTypes.length; i++) {
      const type = groupTypes[i];
      await processGroupType(`https://api.w3.org/groups/${type}`);
      
      // Wait between types (except after the last one)
      if (i < groupTypes.length - 1) {
        await sleep(REQUEST_INTERVAL);
      }
    }
  }

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== Done ==========`);
  console.log(`Total collected items: ${Object.keys(collectedData).length}`);
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