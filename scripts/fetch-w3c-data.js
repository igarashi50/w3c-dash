const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
const REQUEST_INTERVAL = 200;

let collectedGroupsData = {}; // グループ関連データ
let collectedParticipationsData = {}; // participation詳細データ
let collectedUsersData = {}; // ユーザー詳細データ
let collectedAffiliationsData = {}; // affiliations データ
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）

function addToGroupsCollection(url, data) {
  collectedGroupsData[url] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };
}

function addToParticipationsCollection(url, data) {
  collectedParticipationsData[url] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };
}

function addToUsersCollection(url, data) {
  collectedUsersData[url] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };
}

function addToAffiliationsCollection(url, data) {
  collectedAffiliationsData[url] = {
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

function compareAndWriteJson(filename, collectedData) {
  // 所要時間を計算
  const duration = Date.now() - fetchStartTimestamp;
  const durationStr = formatDuration(duration);
  
  const mainFile = `data/${filename}.json`;
  
  // URLでソートしてからJSON化
  const sortedData = {};
  const sortedKeys = Object.keys(collectedData).sort();
  for (const key of sortedKeys) {
    sortedData[key] = collectedData[key];
  }
  
  // メタデータを追加（先頭に配置）
  const dataWithMetadata = {
    _metadata: {
      filename: filename,
      lastChecked: new Date(fetchStartTimestamp).toISOString(),
      fetchStartTime: fetchStartTime,
      duration: durationStr,
      itemCount: Object.keys(sortedData).length
    },
    ...sortedData
  };
  
  const newContent = JSON.stringify(dataWithMetadata, null, 2);
  
  // 既存のファイルと比較（メタデータを除外）
  let hasChanges = true;
  if (fs.existsSync(mainFile)) {
    try {
      const existingContent = fs.readFileSync(mainFile, 'utf8');
      const existingData = JSON.parse(existingContent);
      const newData = JSON.parse(newContent);
      
      // メタデータとfetchedAtを除外して比較
      const existingDataWithoutTimestamp = {};
      const newDataWithoutTimestamp = {};
      
      for (const url in existingData) {
        if (url !== '_metadata') {
          existingDataWithoutTimestamp[url] = existingData[url].data;
        }
      }
      for (const url in newData) {
        if (url !== '_metadata') {
          newDataWithoutTimestamp[url] = newData[url].data;
        }
      }
      
      if (JSON.stringify(existingDataWithoutTimestamp) === JSON.stringify(newDataWithoutTimestamp)) {
        hasChanges = false;
        console.log(`\n✓ No data changes detected in ${filename}, updating metadata only.`);
      }
    } catch (e) {
      console.warn(`Warning: Could not compare with existing file: ${e.message}`);
      hasChanges = true;
    }
  }
  
  // メインファイルを常に更新（メタデータが変わるため）
  fs.writeFileSync(mainFile, newContent, 'utf8');
  if (hasChanges) {
    console.log(`✓ Main file updated with data changes: ${mainFile}`);
  } else {
    console.log(`✓ Main file updated with metadata only: ${mainFile}`);
  }
  
  return hasChanges;
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

async function fetchData(startUrl, targetCollection = 'groups') {
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
    if (targetCollection === 'groups') {
      addToGroupsCollection(startUrl, pages[0]);
    } else if (targetCollection === 'participations') {
      addToParticipationsCollection(startUrl, pages[0]);
    } else if (targetCollection === 'users') {
      addToUsersCollection(startUrl, pages[0]);
    } else if (targetCollection === 'affiliations') {
      addToAffiliationsCollection(startUrl, pages[0]);
    }
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
    
    if (targetCollection === 'groups') {
      addToGroupsCollection(startUrl, merged);
    } else if (targetCollection === 'participations') {
      addToParticipationsCollection(startUrl, merged);
    } else if (targetCollection === 'users') {
      addToUsersCollection(startUrl, merged);
    } else if (targetCollection === 'affiliations') {
      addToAffiliationsCollection(startUrl, merged);
    }
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
    const typePages = await fetchData(typeUrl, 'groups');
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

        // Fetch all participations pages (リストのみ、詳細は後で)
        if (partHref) {
          console.log(`  → Fetching participations list from ${partHref}`);
          const participationsPages = await fetchData(partHref, 'groups');
          console.log(`    ✓ Fetched and merged participations list (${participationsPages.length} page(s) merged)`);
        }

        // Fetch all users pages
        if (usersHref) {
          await sleep(REQUEST_INTERVAL);
          console.log(`  → Fetching users pages from ${usersHref}`);
          const usersPages = await fetchData(usersHref, 'groups');
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

async function fetchAllParticipationDetails() {
  console.log('\n========== Fetching Participation Details ==========');
  
  // w3c-groups.jsonから全participationsのリストを抽出
  const allParticipations = [];
  
  for (const url in collectedGroupsData) {
    const data = collectedGroupsData[url].data;
    if (data._links && data._links.participations && Array.isArray(data._links.participations)) {
      for (const part of data._links.participations) {
        if (part.href && !allParticipations.includes(part.href)) {
          allParticipations.push(part.href);
        }
      }
    }
  }
  
  console.log(`Found ${allParticipations.length} unique participations to fetch\n`);
  
  let fetchedCount = 0;
  for (let i = 0; i < allParticipations.length; i++) {
    const partHref = allParticipations[i];
    
    try {
      await sleep(REQUEST_INTERVAL);
      console.log(`[${i + 1}/${allParticipations.length}] Fetching: ${partHref}`);
      const detailPages = await fetchData(partHref, 'participations');
      
      // Fetch participants for organization participations (individual=false)
      const detail = detailPages[0];
      if (detail && detail.individual === false && detail._links?.participants?.href) {
        const participantsHref = detail._links.participants.href;
        try {
          await sleep(REQUEST_INTERVAL);
          console.log(`  → Fetching participants: ${participantsHref}`);
          const participantsPages = await fetchData(participantsHref, 'participations');
          console.log(`    ✓ Fetched ${participantsPages.length} page(s) of participants`);
        } catch (e) {
          console.warn(`  error fetching participants ${participantsHref}: ${e.message}, skipping`);
        }
      }
      
      fetchedCount++;
      
      // 進捗表示（100件ごと）
      if (fetchedCount % 100 === 0) {
        const duration = Date.now() - fetchStartTimestamp;
        console.log(`\n--- Progress: ${fetchedCount}/${allParticipations.length} (${formatDuration(duration)}) ---\n`);
      }
    } catch (e) {
      console.warn(`error fetching participation ${partHref}: ${e.message}, skipping`);
    }
  }
  
  console.log(`\n✓ Completed: Fetched ${fetchedCount}/${allParticipations.length} participations`);
}

async function fetchAllUsers() {
  console.log('\n========== Fetching User Details ==========');
  
  // participationsから全てのユーザーを抽出
  const allUsers = new Set();
  
  for (const url in collectedParticipationsData) {
    const data = collectedParticipationsData[url].data;
    
    // 1. individual=true または invited-expert=true のユーザー
    if ((data.individual === true || data['invited-expert'] === true) && data._links?.user?.href) {
      allUsers.add(data._links.user.href);
    }
    
    // 2. 組織のparticipants（/participants エンドポイント）からユーザーを抽出
    if (data.individual === false && data._links?.participants) {
      const participantsListHref = url + '/participants';
      const participantsListData = collectedParticipationsData[participantsListHref];
      
      if (participantsListData && participantsListData.data && participantsListData.data._links?.participants) {
        const participants = participantsListData.data._links.participants;
        for (const participant of participants) {
          if (participant.href) {
            allUsers.add(participant.href);
          }
        }
      }
    }
  }
  
  const allUsersArray = Array.from(allUsers);
  console.log(`Found ${allUsersArray.length} unique users to fetch\n`);
  
  let fetchedCount = 0;
  for (let i = 0; i < allUsersArray.length; i++) {
    const userHref = allUsersArray[i];
    
    try {
      await sleep(REQUEST_INTERVAL);
      console.log(`[${i + 1}/${allUsersArray.length}] Fetching: ${userHref}`);
      await fetchData(userHref, 'users');
      
      fetchedCount++;
      
      // 進捗表示（100件ごと）
      if (fetchedCount % 100 === 0) {
        const duration = Date.now() - fetchStartTimestamp;
        console.log(`\n--- Progress: ${fetchedCount}/${allUsersArray.length} (${formatDuration(duration)}) ---\n`);
      }
    } catch (e) {
      console.warn(`error fetching user ${userHref}: ${e.message}, skipping`);
    }
  }
  
  console.log(`\n✓ Completed: Fetched ${fetchedCount}/${allUsersArray.length} users`);
}

async function fetchAllAffiliations() {
  console.log('\n========== Fetching User Affiliations ==========');
  
  // usersDataからユーザーのaffiliationsリストを取得
  const allUsers = Object.keys(collectedUsersData);
  console.log(`Found ${allUsers.length} users to fetch affiliations\n`);
  
  let fetchedAffiliationsLists = 0;
  let fetchedAffiliationDetails = 0;
  
  for (let i = 0; i < allUsers.length; i++) {
    const userHref = allUsers[i];
    const affiliationsHref = userHref.replace(/\/$/, '') + '/affiliations';
    
    try {
      await sleep(REQUEST_INTERVAL);
      console.log(`[${i + 1}/${allUsers.length}] Fetching affiliations list: ${affiliationsHref}`);
      const affiliationsPages = await fetchData(affiliationsHref, 'affiliations');
      fetchedAffiliationsLists++;
      
      // affiliationsリストから各affiliation詳細を取得
      const affiliationsData = affiliationsPages[0];
      if (affiliationsData && affiliationsData._links && affiliationsData._links.affiliations) {
        const affiliationItems = affiliationsData._links.affiliations;
        for (const affItem of affiliationItems) {
          const affHref = affItem.href;
          if (affHref) {
            try {
              await sleep(REQUEST_INTERVAL);
              console.log(`  → Fetching affiliation detail: ${affHref}`);
              await fetchData(affHref, 'affiliations');
              fetchedAffiliationDetails++;
            } catch (e) {
              console.warn(`  error fetching affiliation ${affHref}: ${e.message}, skipping`);
            }
          }
        }
      }
      
      // 進捗表示（20件ごと）
      if ((i + 1) % 20 === 0) {
        const duration = Date.now() - fetchStartTimestamp;
        console.log(`\n--- Progress: ${i + 1}/${allUsers.length} users, ${fetchedAffiliationDetails} affiliation details (${formatDuration(duration)}) ---\n`);
      }
    } catch (e) {
      console.warn(`error fetching affiliations ${affiliationsHref}: ${e.message}, skipping`);
    }
  }
  
  console.log(`\n✓ Completed: Fetched ${fetchedAffiliationsLists} affiliations lists, ${fetchedAffiliationDetails} affiliation details`);
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
  console.log(`
Usage:
  node scripts/fetch-w3c-data.js                    # Fetch all data (groups + participations + users + affiliations)
  node scripts/fetch-w3c-data.js --test             # Test mode (5 sample groups)
  node scripts/fetch-w3c-data.js --groups           # Fetch only groups, participations lists, users lists
  node scripts/fetch-w3c-data.js --participations   # Fetch only participation details (requires w3c-groups.json)
  node scripts/fetch-w3c-data.js --users            # Fetch only user details (requires w3c-participations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Fetch only affiliations (requires w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Fetch groups and participations
  `);
  
  fs.mkdirSync('data', { recursive: true });

  // Check for mode options
  const isTestMode = process.argv.includes('--test');
  const fetchGroups = process.argv.includes('--groups');
  const fetchParticipations = process.argv.includes('--participations');
  const fetchUsers = process.argv.includes('--users');
  const fetchAffiliations = process.argv.includes('--affiliations');
  
  // オプション指定がない場合は全て取得
  const fetchAll = !fetchGroups && !fetchParticipations && !fetchUsers && !fetchAffiliations;
  const shouldFetchGroups = fetchAll || fetchGroups;
  const shouldFetchParticipations = fetchAll || fetchParticipations;
  const shouldFetchUsers = fetchAll || fetchUsers;
  const shouldFetchAffiliations = fetchAll || fetchAffiliations;
  
  // Phase 1: Groups, Participations Lists, Users
  if (shouldFetchGroups) {
    console.log('\n========== PHASE 1: Fetching Groups, Participations Lists, and Users ==========\n');
    
    if (isTestMode) {
      console.log('Running in TEST mode - fetching 6 sample groups\n');
      
      // Test with one group from each type
      const testGroups = [
      { type: 'wg', shortname: 'css' },
      { type: 'ig', shortname: 'i18n' },
      { type: 'ig', shortname: 'web-and-ai' },
      { type: 'cg', shortname: 'global-inclusion' },
      { type: 'tf', shortname: 'ab-elected' },
      { type: 'other', shortname: 'ab' }
    ];
    
    for (let i = 0; i < testGroups.length; i++) {
      const { type, shortname } = testGroups[i];
      const typeUrl = `https://api.w3.org/groups/${type}`;
      
      console.log(`\n========== Processing ${type.toUpperCase()} (test mode) ==========`);
      
      // Fetch the type list
      const typePages = await fetchData(typeUrl, 'groups');
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
          
          // Fetch participations list
          if (partHref) {
            console.log(`  → Fetching participations list from ${partHref}`);
            const participationsPages = await fetchData(partHref, 'groups');
            console.log(`    ✓ Fetched and merged participations list (${participationsPages.length} page(s) merged)`);
          }
          
          // Fetch users
          if (usersHref) {
            await sleep(REQUEST_INTERVAL);
            console.log(`  → Fetching users pages from ${usersHref}`);
            const usersPages = await fetchData(usersHref, 'groups');
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
    
    // Phase 1完了 - w3c-groups.jsonを保存
    console.log(`\n========== PHASE 1 Complete ==========`);
    console.log(`Total groups data collected: ${Object.keys(collectedGroupsData).length}`);
    const phase1Written = compareAndWriteJson('w3c-groups', collectedGroupsData);
    if (phase1Written) {
      console.log('✓ Groups data successfully saved');
    }
  } // end of shouldFetchGroups
  
  // Phase 2 - Participation詳細の取得
  if (shouldFetchParticipations) {
    console.log('\n========== PHASE 2: Fetching Participation Details ==========\n');
    
    // groupsを取得していない場合、w3c-groups.json を読み込む
    if (!shouldFetchGroups) {
      console.log('Loading w3c-groups.json (--groups not specified)\n');
      try {
        const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
        collectedGroupsData = JSON.parse(groupsContent);
        console.log(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json\n`);
      } catch (e) {
        console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
        console.error('Please run with --groups first to generate w3c-groups.json');
        process.exit(1);
      }
    }
    
    await fetchAllParticipationDetails();
    
    // Phase 2完了 - w3c-participations.jsonを保存
    console.log(`\n========== PHASE 2 Complete ==========`);
    console.log(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
    const phase2Written = compareAndWriteJson('w3c-participations', collectedParticipationsData);
    if (phase2Written) {
      console.log('✓ Participations data successfully saved');
    }
  } // end of shouldFetchParticipations
  
  // Phase 3 - Users の取得
  if (shouldFetchUsers) {
    console.log('\n========== PHASE 3: Fetching User Details ==========\n');
    
    // participationsを読み込む
    if (!shouldFetchParticipations) {
      console.log('Loading w3c-participations.json (--participations not specified)\n');
      try {
        const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
        collectedParticipationsData = JSON.parse(participationsContent);
        console.log(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json\n`);
      } catch (e) {
        console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
        console.error('Please run with --participations first to generate w3c-participations.json');
        process.exit(1);
      }
    }
    
    await fetchAllUsers();
    
    // Phase 3完了 - w3c-users.jsonを保存
    console.log(`\n========== PHASE 3 Complete ==========`);
    console.log(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
    const phase3Written = compareAndWriteJson('w3c-users', collectedUsersData);
    if (phase3Written) {
      console.log('✓ Users data successfully saved');
    }
  } // end of shouldFetchUsers
  
  // Phase 4 - Affiliations の取得
  if (shouldFetchAffiliations) {
    console.log('\n========== PHASE 4: Fetching Affiliations ==========\n');
    
    // usersを読み込む
    if (!shouldFetchUsers) {
      console.log('Loading w3c-users.json (--users not specified)\n');
      try {
        const usersContent = fs.readFileSync('data/w3c-users.json', 'utf8');
        collectedUsersData = JSON.parse(usersContent);
        console.log(`Loaded ${Object.keys(collectedUsersData).length} items from w3c-users.json\n`);
      } catch (e) {
        console.error(`Error: Cannot load w3c-users.json: ${e.message}`);
        console.error('Please run with --users first to generate w3c-users.json');
        process.exit(1);
      }
    }
    
    await fetchAllAffiliations();
    
    // Phase 4完了 - w3c-affiliations.jsonを保存
    console.log(`\n========== PHASE 4 Complete ==========`);
    console.log(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
    const phase4Written = compareAndWriteJson('w3c-affiliations', collectedAffiliationsData);
    if (phase4Written) {
      console.log('✓ Affiliations data successfully saved');
    }
  } // end of shouldFetchAffiliations

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== All Done ==========`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  console.log(`Groups data: ${Object.keys(collectedGroupsData).length} items`);
  console.log(`Participations data: ${Object.keys(collectedParticipationsData).length} items`);
  console.log(`Users data: ${Object.keys(collectedUsersData).length} items`);
  console.log(`Affiliations data: ${Object.keys(collectedAffiliationsData).length} items`);
}

main().catch(e => { 
  console.error('Fatal error:', e);
  process.exit(1); 
});