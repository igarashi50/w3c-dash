// 先頭でデータ用変数を宣言
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

// minimist不要: シンプルなフラグ判定
const VERBOSE = process.argv.includes('--verbose');

// グローバル変数廃止。各Phase関数で都度ファイルロード・ローカル変数化。
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
const REQUEST_INTERVAL = 200;


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

async function compareAndWriteJson(filename, collectedData) {
  // 所要時間を計算
  const duration = Date.now() - fetchStartTimestamp;
  const durationStr = formatDuration(duration);
  
  const mainFile = `data/${filename}.json`;
  
  let hasChanges = true;
  let sortedData = {};
  let existingMetadata = {};
  try {
    // 既存ファイルがあれば比較
    if (fs.existsSync(mainFile)) {
      const prevContent = fs.readFileSync(mainFile, 'utf8');
      const prevJson = JSON.parse(prevContent);
      existingMetadata = prevJson._metadata || {};
      // データ部分のみ比較（_metadata除外）
      const prevData = Object.assign({}, prevJson);
      delete prevData._metadata;
      // 新データをソート
      sortedData = {};
      Object.keys(collectedData).sort().forEach(k => { sortedData[k] = collectedData[k]; });
      // 差分判定
      hasChanges = JSON.stringify(prevData) !== JSON.stringify(sortedData);
    } else {
      sortedData = {};
      Object.keys(collectedData).sort().forEach(k => { sortedData[k] = collectedData[k]; });
      hasChanges = true;
    }
  } catch (e) {
    console.error(`Failed to write ${filename}.json: ${e.message}`);
  }
  // データが変わっていない場合は既存のメタデータとfetchedAtを使用、変わった場合は新しいメタデータ
  const finalDataWithMetadata = {
    _metadata: hasChanges ? {
      filename: filename,
      lastChecked: new Date(fetchStartTimestamp).toISOString(),
      fetchStartTime: fetchStartTime,
      duration: durationStr,
      itemCount: Object.keys(sortedData).length
    } : existingMetadata,
    ...sortedData
  };
  const finalContent = JSON.stringify(finalDataWithMetadata, null, 2);
  fs.writeFileSync(mainFile, finalContent, 'utf8');
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

      if (VERBOSE) console.log(`request for ${url}`);
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
  if (!startUrl) return {};

  const pages = [];
  let url = startUrl;

  // グループタイプを抽出（例: /groups/wg, /groups/ig, /groups/cg など）
  const groupTypeMatch = startUrl.match(/\/groups\/(wg|ig|cg|tf|other)(?:\/|$)/);
  const groupType = groupTypeMatch ? groupTypeMatch[1] : null;

  // すべてのページを取得
  while (url) {
    if (VERBOSE) console.log(`request for ${url}`);
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
      if (e.message && e.message.startsWith('404')) {
        console.warn(`[WARN] Not Found: ${url} (${e.message})`);
      } else {
        console.warn(`error fetching ${url}: ${e.message}, skipping`);
      }
      const errObj = { error: String(e) };
      pages.push(errObj);
      break;
    }
  }

  const resultObj = {};

  // ページが1つだけの場合、resultObjに格納
  if (pages.length === 1) {
    resultObj[startUrl] = {
      fetchedAt: new Date().toISOString(),
      data: pages[0]
    };
    return resultObj;
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

    resultObj[startUrl] = {
      fetchedAt: new Date().toISOString(),
      data: merged
    };
    return resultObj;
  }

  return resultObj;
}

async function fetchGroups(typeUrl, collectedGroupsData, testGroupShortNames = null) {
  // typeUrl: 'https://api.w3.org/groups/wg' など
  // collectedGroupsData: {} or 既存データ
  const typeMatch = typeUrl.match(/\/groups\/([^/?]+)/);
  const typeName = typeMatch ? typeMatch[1].toUpperCase() : 'UNKNOWN';
  console.log(`\n========== Processing ${typeName} ==========`);
  try {
    // Fetch all pages for this group type
    console.log(`Fetching ${typeName} list pages...`);
    const typePagesObj = await fetchData(typeUrl, 'groups');
    Object.assign(collectedGroupsData, typePagesObj);
    // Extract groups from the merged result
    const typePagesArr = Object.values(typePagesObj);
    let groups = typePagesArr[0]?.data?._links?.groups || [];
    console.log(`Found ${groups.length} ${typeName} groups\n`);

    // テストモードの場合、shortnameでフィルタリング
    if (testGroupShortNames && Array.isArray(testGroupShortNames)) {
      groups = groups.filter(g => {
        const href = g.href || '';
        return testGroupShortNames.some(shortname => href.includes(`/${typeName.toLowerCase()}/${shortname}`));
      });
      console.log(`Filtered for testShortNames: ${testGroupShortNames.join(', ')} → ${groups.length} groups`);
    }

    let processedCount = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const groupName = g.title || g.name || g.id || 'unknown';
      console.log(`[${i + 1}/${groups.length}] Processing: ${groupName}`);
      try {
        // Fetch group details
        const groupHref = g.href;
        if (groupHref) {
          console.log(`  → Fetching group details from ${groupHref}`);
          Object.assign(collectedGroupsData, await fetchData(groupHref));
          console.log(`    ✓ Fetched group details`);
        }
        const partHref = g._links?.participations?.href || (g.href ? g.href.replace(/\/$/, '') + '/participations' : null);
        const usersHref = g._links?.users?.href || (g.href ? g.href.replace(/\/$/, '') + '/users' : null);
        // Fetch all participations pages (リストのみ、詳細は後で)
        if (partHref) {
          console.log(`  → Fetching participations list from ${partHref}`);
          Object.assign(collectedGroupsData, await fetchData(partHref));
          console.log(`    ✓ Fetched and merged participations list`);
        }
        // Fetch all users pages
        if (usersHref) {
          await sleep(REQUEST_INTERVAL);
          console.log(`  → Fetching users pages from ${usersHref}`);
          Object.assign(collectedGroupsData, await fetchData(usersHref));
          console.log(`    ✓ Fetched and merged users`);
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
  return collectedGroupsData;
}

async function fetchAllParticipationDetails(collectedGroupsData, collectedParticipationsData) {
  console.log('\n========== Fetching Participation Details ==========');
  // w3c-groups.jsonから全participationsのリストを抽出
  const allParticipations = [];
  for (const url in collectedGroupsData) {
    const entry = collectedGroupsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    if (data._links && data._links.participations && Array.isArray(data._links.participations)) {
      for (const part of data._links.participations) {
        if (part && part.href && !allParticipations.includes(part.href)) {
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
      // 取得結果をコレクションに追加
      if (detailPages && detailPages[0]) {
        collectedParticipationsData[partHref] = {
          fetchedAt: new Date().toISOString(),
          data: detailPages[0]
        };
      }
      // Fetch participants for organization participations (individual=false)
      const detail = detailPages[0];
      if (detail && detail.individual === false && detail._links?.participants?.href) {
        const participantsHref = detail._links.participants.href;
        try {
          await sleep(REQUEST_INTERVAL);
          console.log(`  → Fetching participants: ${participantsHref}`);
          const participantsPages = await fetchData(participantsHref, 'participations');
          if (participantsPages && participantsPages[0]) {
            collectedParticipationsData[participantsHref] = {
              fetchedAt: new Date().toISOString(),
              data: participantsPages[0]
            };
          }
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

async function fetchAllUsers(collectedGroupsData, collectedParticipationsData, collectedUsersData) {
  console.log('\n========== Fetching User Details ==========');
  
  // participationsから全てのユーザーを抽出
  const allUsers = new Set();
  
  for (const url in collectedParticipationsData) {
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
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
          if (participant && participant.href) {
            allUsers.add(participant.href);
          }
        }
      }
    }
  }
  
  // 3. groupsの_links.usersからもユーザーを抽出（participations=0のグループ対応）
  for (const url in collectedGroupsData) {
    if (url === '_metadata') continue;
    if (VERBOSE) {
      console.log(`[DEBUG] groupsの_links.usersからもユーザーを抽出（group: ${url}`);
    }
    const data = collectedGroupsData[url].data;
    if (VERBOSE) {
      console.log(`[DEBUG] groupsの_links.usersからもユーザーを抽出（data: ${data}`);
    }
    if (data && data._links?.users && typeof data._links.users === 'object' && !Array.isArray(data._links.users)) {
      // グループの _links.users はユーザーリストのURLオブジェクト
      const usersListUrl = data._links.users.href;
      if (usersListUrl) {
        const usersListData = collectedGroupsData[usersListUrl];
        if (usersListData && usersListData.data && usersListData.data._links?.users && Array.isArray(usersListData.data._links.users)) {
          const userArr = usersListData.data._links.users;
          if (VERBOSE) {
            console.log(`[DEBUG] usersListUrl: ${usersListUrl}`);
            console.log(`[DEBUG] users count: ${userArr.length}`);
          }
          for (const user of userArr) {
            if (user && user.href) {
              allUsers.add(user.href);
              if (VERBOSE) console.log(`[DEBUG] user href: ${user.href}`);
            }
          }
        }
      }
    }
  }

  // ユーザー抽出が完了したら、APIフェッチループを分離して実行
  const allUsersArray = Array.from(allUsers);
  let fetchedCount = 0;
  for (let i = 0; i < allUsersArray.length; i++) {
    const userHref = allUsersArray[i];
    try {
      if (VERBOSE) {
        console.log(`[${i + 1}/${allUsersArray.length}] Fetching: ${userHref}`);
      }
      await fetchData(userHref, 'users');
      fetchedCount++;
      // 進捗表示（100件ごと、または最後）
      if (fetchedCount % 100 === 0 || i === allUsersArray.length - 1) {
        console.log(`--- Progress: ${fetchedCount}/${allUsersArray.length} user details (${formatDuration(Date.now() - fetchStartTimestamp)})`);
      }
    } catch (e) {
      if (VERBOSE) {
        console.warn(`error fetching user ${userHref}: ${e.message}, skipping`);
      }
      // エラーも必ず記録
      // addToUsersCollection(userHref, { _error: String(e) });
    }
    // fetchDataが失敗してもaddToUsersCollectionでキーを必ず残す
    // if (!collectedUsersData[userHref]) {
    //   addToUsersCollection(userHref, { _error: 'No API response' });
    // }
  }
  console.log(`\n✓ Completed: Fetched ${fetchedCount}/${allUsersArray.length} users`);
}

async function fetchAllAffiliations(collectedUsersData, collectedAffiliationsData) {
  console.log('\n========== Fetching User Affiliations ==========');
  // usersDataからユーザーのaffiliationsリストを取得
  const allUsers = Object.keys(collectedUsersData).filter(u => u !== '_metadata');
  console.log(`Found ${allUsers.length} users to fetch affiliations\n`);
  let fetchedAffiliations = 0;
  for (let i = 0; i < allUsers.length; i++) {
    const userHref = allUsers[i];
    const affListHref = userHref + '/affiliations';
    try {
      await sleep(REQUEST_INTERVAL);
      if (VERBOSE) console.log(`[${i + 1}/${allUsers.length}] Fetching affiliations list: ${affListHref}`);
      const affListPages = await fetchData(affListHref, 'affiliations');
      if (affListPages && affListPages[0]) {
        collectedAffiliationsData[affListHref] = {
          fetchedAt: new Date().toISOString(),
          data: affListPages[0]
        };
      }
      fetchedAffiliations++;
      if (fetchedAffiliations % 100 === 0 || i === allUsers.length - 1) {
        const duration = Date.now() - fetchStartTimestamp;
        console.log(`--- Progress: ${i + 1}/${allUsers.length} users, ${fetchedAffiliations} affiliation details (${formatDuration(duration)})`);
      }
    } catch (e) {
      // ...
    }
  }
  console.log(`\n✓ Completed: Fetched ${fetchedAffiliations}/${allUsers.length} affiliations lists`);
  return collectedAffiliationsData;
}


async function phase1_fetchGroupsParticipationsUsers({isTestMode}) {
  // shouldFetchGroupsはmainで判定。isTestModeのみ引数で受け取る。
  console.log('\n========== PHASE 1: Fetching Groups, Participations Lists, and Users ==========\n');
  let collectedGroupsData = {};
    let testGroupsShortNamesMap = {};  // テストでのtypeごとのshortname配列を格納するオブジェクト
  if (isTestMode) {
    // typeごとにshortname配列をまとめる
    const testGroups = [
      { type: 'wg', shortname: 'css' },
      { type: 'wg', shortname: 'miniapps' },
      { type: 'ig', shortname: 'i18n' },
      { type: 'ig', shortname: 'webai' },
      { type: 'cg', shortname: 'global-inclusion' },
      { type: 'tf', shortname: 'ab-elected' },
      { type: 'other', shortname: 'ab' }
    ];
    // typeごとにshortnameリストを作成
    for (const { type, shortname } of testGroups) {
        if (!testGroupsShortNamesMap[type]) testGroupsShortNamesMap[type] = [];
      testGroupsShortNamesMap[type].push(shortname);
    }
    console.log(`Running in TEST mode - fetching ${testGroups.length} sample groups\n`);
  }
  // groupをフェッチ
  const groupTypes = ['wg', 'ig', 'cg', 'tf', 'other'];
  for (let i = 0; i < groupTypes.length; i++) {
    const type = groupTypes[i];
    const testGroupShortNames = testGroupsShortNamesMap[type]; // テストモード時のみshortname配列を渡す
    const typeGroupsData = await fetchGroups(`https://api.w3.org/groups/${type}`, collectedGroupsData, testGroupShortNames);
    Object.assign(collectedGroupsData, typeGroupsData);
    if (i < groupTypes.length - 1) {
        await sleep(REQUEST_INTERVAL);
      }
  }
  console.log(`\n========== PHASE 1 Complete ==========`);
  // 保存
  console.log(`Total groups data collected: ${Object.keys(collectedGroupsData).length}`);
  const phase1Written = compareAndWriteJson('w3c-groups', collectedGroupsData);
  if (phase1Written) {
    console.log('✓ Groups data successfully saved');
  }
}

async function phase2_fetchParticipations() {
  console.log('\n========== PHASE 2: Fetching Participation Details ==========\n');
  // groupsデータを都度ロード
  let collectedGroupsData = {};
  try {
    const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    console.log(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
    process.exit(1);
  }
  // participationデータは空で開始
  let collectedParticipationsData = await fetchAllParticipationDetails(collectedGroupsData, {});
  console.log(`\n========== PHASE 2 Complete ==========`);
  console.log(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
  const phase2Written = compareAndWriteJson('w3c-participations', collectedParticipationsData);
  if (phase2Written) {
    console.log('✓ Participations data successfully saved');
  }
}

async function phase3_fetchUsers() {
  console.log('\n========== PHASE 3: Fetching User Details ==========\n');
  // groupsデータを都度ロード
  let collectedGroupsData = {};
  try {
    const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    console.log(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
    process.exit(1);
  }
  // participationsデータを都度ロード
  let collectedParticipationsData = {};
  try {
    const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    console.log(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
    process.exit(1);
  }
  // usersデータは空で開始
  let collectedUsersData = await fetchAllUsers(collectedGroupsData, collectedParticipationsData, {});
  console.log(`\n========== PHASE 3 Complete ==========`);
  console.log(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
  const phase3Written = compareAndWriteJson('w3c-users', collectedUsersData);
  if (phase3Written) {
    console.log('✓ Users data successfully saved');
  }
}

async function phase4_fetchAffiliations() {
  // shouldFetchAffiliationsはmainで判定。shouldFetchUsersのみ引数で受け取る。
  console.log('\n========== PHASE 4: Fetching Affiliations ==========\n');
  // usersデータを都度ロード
  let collectedUsersData = {};
  try {
    const usersContent = fs.readFileSync('data/w3c-users.json', 'utf8');
    collectedUsersData = JSON.parse(usersContent);
    console.log(`Loaded ${Object.keys(collectedUsersData).length} items from w3c-users.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-users.json: ${e.message}`);
    process.exit(1);
  }
  // affiliationsデータは空で開始
  let collectedAffiliationsData = await fetchAllAffiliations(collectedUsersData, {});
  console.log(`\n========== PHASE 4 Complete ==========`);
  console.log(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
  const phase4Written = compareAndWriteJson('w3c-affiliations', collectedAffiliationsData);
  if (phase4Written) {
    console.log('✓ Affiliations data successfully saved');
  }
}

async function main() {
  fetchStartTimestamp = Date.now();
  const now = new Date(fetchStartTimestamp);
  fetchStartTime = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/T/, '-')
    .split('.')[0];
  console.log(`Fetch started at: ${fetchStartTime}`);
  const allowedOptions = [
    '--groups', '--test', '--participations', '--users', '--affiliations', '--verbose', '--help', '-h'
  ];
  const unknownOptions = process.argv.slice(2).filter(opt => opt.startsWith('--') && !allowedOptions.includes(opt));
  if (unknownOptions.length > 0) {
    console.error(`Error: Unsupported option(s): ${unknownOptions.join(', ')}`);
    console.log(`\nUsage:
  node scripts/fetch-w3c-data.js                    # Fetch all data (groups + participations + users + affiliations)
  node scripts/fetch-w3c-data.js --groups --test     # Test mode (7 sample groups, groups phase only)
  node scripts/fetch-w3c-data.js --groups           # Fetch only groups, participations lists, users lists
  node scripts/fetch-w3c-data.js --participations   # Fetch only participation details (requires w3c-groups.json)
  node scripts/fetch-w3c-data.js --users            # Fetch only user details (requires w3c-participations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Fetch only affiliations (requires w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Fetch groups and participations
  node scripts/fetch-w3c-data.js --verbose          # Show detailed fetch logs\n`);
    process.exit(1);
  }
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`\nUsage:
  node scripts/fetch-w3c-data.js                    # Fetch all data (groups + participations + users + affiliations)
  node scripts/fetch-w3c-data.js --groups --test     # Test mode (7 sample groups, groups phase only)
  node scripts/fetch-w3c-data.js --groups           # Fetch only groups, participations lists, users lists
  node scripts/fetch-w3c-data.js --participations   # Fetch only participation details (requires w3c-groups.json)
  node scripts/fetch-w3c-data.js --users            # Fetch only user details (requires w3c-participations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Fetch only affiliations (requires w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Fetch groups and participations
  node scripts/fetch-w3c-data.js --verbose          # Show detailed fetch logs\n`);
    process.exit(0);
  }
  fs.mkdirSync('data', { recursive: true });
  const isTestMode = process.argv.includes('--test') && process.argv.includes('--groups');
  const fetchGroups = process.argv.includes('--groups');
  const fetchParticipations = process.argv.includes('--participations');
  const fetchUsers = process.argv.includes('--users');
  const fetchAffiliations = process.argv.includes('--affiliations');
  const fetchAll = !fetchGroups && !fetchParticipations && !fetchUsers && !fetchAffiliations;

  if (fetchAll  || fetchGroups) {
    await phase1_fetchGroupsParticipationsUsers({ isTestMode });
  }
  if (fetchAll || fetchParticipations) {
    await phase2_fetchParticipations();
  }
  if (fetchAll || fetchUsers) {
    await phase3_fetchUsers({});
  }
  if (fetchAll　|| fetchAffiliations) {
    await phase4_fetchAffiliations();
  }

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== All Done ==========`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  // 各ファイルを都度ロードして件数表示
  try {
    const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
    const groupsData = JSON.parse(groupsContent);
    // テストモード時はFiltered Groups数も表示
    let totalGroupsCount = 0;
    for (const key of Object.keys(groupsData)) {
      if (key === '_metadata') continue;
      // /groups/{type} のリストページ
      if (/\/groups\/(wg|ig|cg|tf|other)$/.test(key)) {
        const entry = groupsData[key];
        if (entry && entry.data && entry.data._links && Array.isArray(entry.data._links.groups)) {
          totalGroupsCount += entry.data._links.groups.length;
        }
      }
    }
    let testedGroupsCount = 0;
    for (const key of Object.keys(groupsData)) {
      if (key === '_metadata') continue;
      // /groups/{type}/{shortname} 形式のみカウント
      if (/\/groups\/(wg|ig|cg|tf|other)\/[a-zA-Z0-9\-]+$/.test(key)) {
        testedGroupsCount++;
      }
    }
    if (isTestMode) {
      console.log(`Total Groups: ${totalGroupsCount}`);
      console.log(`Tested Groups: ${testedGroupsCount}`);
    } else {
      console.log(`Total Groups: ${totalGroupsCount}`);
    }
    console.log(`Groups data: ${Object.keys(groupsData).length} items`);
  } catch {}
  try {
    const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
    const participationsData = JSON.parse(participationsContent);
    console.log(`Participations data: ${Object.keys(participationsData).length} items`);
  } catch {}
  try {
    const usersContent = fs.readFileSync('data/w3c-users.json', 'utf8');
    const usersData = JSON.parse(usersContent);
    console.log(`Users data: ${Object.keys(usersData).length} items`);
  } catch {}
  try {
    const affiliationsContent = fs.readFileSync('data/w3c-affiliations.json', 'utf8');
    const affiliationsData = JSON.parse(affiliationsContent);
    console.log(`Affiliations data: ${Object.keys(affiliationsData).length} items`);
  } catch {}
}

main().catch(e => { 
  console.error('Fatal error:', e);
  process.exit(1); 
});