// 先頭でデータ用変数を宣言
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const { error, group, dir } = require('console');

// minimist不要: シンプルなフラグ判定
const VERBOSE = process.argv.includes('--verbose');
function logAlways(msg) { console.log(msg); }
function logVerbose(msg) { if (VERBOSE) console.log(msg); }

// グローバル変数廃止。各Phase関数で都度ファイルロード・ローカル変数化。
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）
let phaseRequestCount = 0; // 各PhaseのfetchJson呼び出し回数
let phaseStartTimestamp = 0; // 各Phaseの開始時刻
let totalRequestCount = 0; // 全体のfetchJson呼び出し回数
let phaseRequestCounts = []; // 各Phaseごとのリクエスト数

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
const REQUEST_INTERVAL = 200;


forceTestMode = false;   // テストモードフラグ
// typeごとにshortname配列をまとめる
const testGroups = [
  { type: 'wg', shortname: 'css' },
  { type: 'wg', shortname: 'miniapps' },
  { type: 'wg', shortname: 'wot' },
  { type: 'ig', shortname: 'i18n' },
  //{ type: 'cg', shortname: 'global-inclusion' },
  //{ type: 'tf', shortname: 'ab-elected' },
  { type: 'other', shortname: 'ab' }
];

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

async function compareAndWriteJson(dirPath, filename, collectedData) {
  ;
  const filePath = `${dirPath}/${filename}`;
  // 所要時間を計算
  const duration = Date.now() - fetchStartTimestamp;
  const durationStr = formatDuration(duration);
  let hasChanges = false;
  let mergedData = {};
  try {
    // 既存ファイルがあれば比較
    if (fs.existsSync(filePath)) {
      const prevContent = fs.readFileSync(filePath, 'utf8');
      const prevJson = JSON.parse(prevContent);
      const prevData = { ...prevJson };
      delete prevData._metadata;
      // キーごとに比較し、dataが同じなら古いfetchedAtを引き継ぐ
      const newData = { ...collectedData };
      delete newData._metadata;
      const allKeys = Array.from(new Set([...Object.keys(prevData), ...Object.keys(newData)]));
      let changedCount = 0;
      for (const k of allKeys.sort()) {
        const prevEntry = prevData[k];
        const newEntry = newData[k];
        // どちらも存在する場合のみdata比較
        if (prevEntry && newEntry && prevEntry.data && newEntry.data) {
          // fetchedAtを除いたdataで比較
          const prevDataStripped = JSON.stringify(prevEntry.data);
          const newDataStripped = JSON.stringify(newEntry.data);
          if (prevDataStripped === newDataStripped) {
            // dataが同じなら古いfetchedAtを使う
            mergedData[k] = { ...newEntry, fetchedAt: prevEntry.fetchedAt };
          } else {
            // dataが違う場合は新しいまま
            mergedData[k] = newEntry;
            changedCount++;
          }
        } else if (newEntry) {
          // 新規追加（新しい方にはあるが古い方にはない
          mergedData[k] = newEntry;
          changedCount++;
        } else {
          // 削除（古い方にはあるが、新しい方にはない）ー＞mergedDataに入れない
          changedCount++
        }
      }
      hasChanges = changedCount > 0;
    } else {
      // 既存ファイルがなければ新規
      Object.keys(collectedData).sort().forEach(k => { mergedData[k] = collectedData[k]; });
      hasChanges = true;
    }
    // _metadataは後で付与
  } catch (e) {
    console.error(`Failed to write ${filePath}: ${e.message}`);
  }
  // データが変わっていない場合はファイル保存を行わない
  if (!hasChanges) {
    console.log(`✓ No changes detected: ${filePath} not updated.`);
    return false;
  }
  const finalDataWithMetadata = {
    _metadata: {
      filename: filename,
      lastChecked: new Date(fetchStartTimestamp).toISOString(),
      fetchStartTime: fetchStartTime,
      duration: durationStr,
      itemCount: Object.keys(mergedData).length
    },
    ...mergedData
  };
  const finalContent = JSON.stringify(finalDataWithMetadata, null, 2);
  fs.writeFileSync(filePath, finalContent, 'utf8');
  console.log(`✓ File updated with data changes: ${filePath}`);
  return true;
};

function fetchJson(url, retries = 6, backoffMs = 5000, timeoutMs = 180000, redirects = 5) {
  phaseRequestCount++;
  totalRequestCount++;
  return new Promise((resolve, reject) => {
    try {
      const target = new URL(url);
      const lib = target.protocol === 'http:' ? http : https;
      const headers = {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip,deflate',
        'Connection': 'close',
        'User-Agent': 'curl/8.0.1'
      };

      if (VERBOSE && !process.env.SUPPRESS_REQUEST_LOG) console.log(`    [REQUEST] ${url}`);
      const req = lib.get(url, { headers, timeout: timeoutMs }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && redirects > 0 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchJson(next, retries, backoffMs, timeoutMs, redirects - 1));
        }

        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', async () => {
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();

          // [RESPONSE] ログ出力（status, content-length, Last-Modified）
          if (VERBOSE && !process.env.SUPPRESS_REQUEST_LOG) {
            const status = res.statusCode;
            const clen = res.headers['content-length'] || raw.length;
            const lastModified = res.headers['last-modified'] || '';
            console.log(`    [RESPONSE] status=${status} content-length=${clen} last-modified=${lastModified}`);
          }

          // HTTPエラー時はレスポンスボディも記録
          if (res.statusCode >= 400) {
            if (res.statusCode === 429 && retries > 0) {
              const ra = parseInt(res.headers['retry-after'], 10);
              const waitMs = Number.isFinite(ra) ? ra * 1000 : backoffMs;
              console.warn(`429 for ${url}, wait ${waitMs}ms (${retries - 1} retries left)`);
              await new Promise(r => setTimeout(r, waitMs));
              return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects).then(resolve).catch(reject);
            }
            // 5xx系はリトライ対象
            if (res.statusCode >= 500 && res.statusCode < 600 && retries > 0) {
              const retryNum = 7 - retries;
              const msg = `[RETRY] ${url} (HTTP ${res.statusCode}) (${retryNum}/6) wait ${backoffMs}ms`;
              if (VERBOSE) {
                console.warn(msg + ` [RESPONSE BODY]`);
              } else {
                console.warn(msg);
              }
              await new Promise(r => setTimeout(r, backoffMs));
              return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects).then(resolve).catch(reject);
            }
            let bodyText = '';
            try {
              if (enc === 'gzip') {
                bodyText = await new Promise((resolveText, rejectText) => {
                  zlib.gunzip(raw, (err, out) => err ? rejectText(err) : resolveText(out.toString('utf8')));
                });
              } else if (enc === 'deflate') {
                bodyText = await new Promise((resolveText, rejectText) => {
                  zlib.inflate(raw, (err, out) => err ? rejectText(err) : resolveText(out.toString('utf8')));
                });
              } else {
                bodyText = raw.toString('utf8');
              }
            } catch (decompErr) {
              bodyText = `[decompression error: ${decompErr}]`;
            }
            const errorDetail = {
              statusCode: res.statusCode,
              url,
              headers: res.headers,
              message: `HTTP error ${res.statusCode}`,
              body: bodyText
            };
            return reject(errorDetail);
          }

          const finish = (buf) => {
            try {
              const text = buf.toString('utf8');
              const data = JSON.parse(text);
              return resolve(data);
            } catch (e) {
              // パース失敗時はテキストも記録
              return reject({
                error: e,
                url,
                statusCode: res.statusCode,
                headers: res.headers,
                rawText: buf.toString('utf8')
              });
            }
          };

          if (enc === 'gzip') {
            zlib.gunzip(raw, (err, out) => err ? reject({ error: err, url, statusCode: res.statusCode, headers: res.headers }) : finish(out));
          } else if (enc === 'deflate') {
            zlib.inflate(raw, (err, out) => err ? reject({ error: err, url, statusCode: res.statusCode, headers: res.headers }) : finish(out));
          } else {
            finish(raw);
          }
        });
      });

      req.on('error', async (err) => {
        // 詳細なエラー情報をコンソールに出力
        const retryNum = 7 - retries;
        const msg = `[RETRY] request error for ${url}: message=${err.message} code=${err.code || ''} (retry ${retryNum}/6)`;
        if (retries > 0) {
          if (VERBOSE) {
            console.warn(msg + ` stack=${err.stack || ''}`);
          } else {
            console.warn(msg);
          }
          const wait = backoffMs;
          console.warn(`[RETRY] ${url} (${retryNum}/6) wait ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects).then(resolve).catch(reject);
        }
        // JSONにも詳細を記録
        reject({
          message: err.message,
          code: err.code,
          stack: err.stack,
          url
        });
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
  if (!startUrl) return undefined;

  const pages = [];
  let url = startUrl;
  let page = 1; // 初期ページ
  let lastError = undefined;

  while (url) {
    let fetchStart = Date.now();
    let fetchEnd;
    try {
      const r = await fetchJson(url, 6, 5000, 120000);
      pages.push(r);
      // レスポンスから総ページ数を取得して次のURLを構築
      const totalPages = r.pages || 1;
      if (page < totalPages) {
        page += 1;
        url = `${startUrl.split('?')[0]}?page=${page}`;
      } else {
        url = null; // 最後のページに到達
      }
    } catch (err) {
      lastError = err;
      console.log(`    [ERROR] fetchData error for ${url}: ${JSON.stringify(err).substring(0, 200)}`);
      break;
    } finally {
      fetchEnd = Date.now();
    }
    const elapsed = fetchEnd - fetchStart;
    const sleepMs = REQUEST_INTERVAL - elapsed;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
    if (VERBOSE) { console.log(`    [INFO] elapsed ${elapsed}ms  sleep ${sleepMs}ms`); }
    if (lastError) break;
  }

  // ページが1つだけの場合
  if (pages.length === 1) {
    return pages[0];
  }
  // 複数ページの場合、正常ページのみマージ。全ページエラーならundefined
  const validPages = pages.filter(p => !p.error);
  if (validPages.length > 0) {
    const merged = {
      page: 1,
      limit: 0,
      pages: 1,
      total: 0,
      _links: {}
    };
    const allItems = [];
    let dataKey = null;
    for (const page of validPages) {
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
    return merged;
  } else {
    return undefined;
  }
}

async function fetchTypeGroups(type, testGroupShortNames = null) {
  const typeName = type.toUpperCase();
  logAlways(`Start fetching type groups: ${typeName}`);
  let collectedTypeGroupsData = {};
  const typeUrl = `https://api.w3.org/groups/${type}`;
  // typeUrl: 'https://api.w3.org/groups/wg' など
  // collectedGroupsData: {} or 既存データ
  // 通常ログのみで出力（重複防止）

  let fetchCount = 0;
  let errorCount = 0;
  let fetchedCount = 0;

  let groupsArray = [];
  let data = {};
  try {
    if (VERBOSE) console.log(`  → Fetching data from ${typeUrl}`);
    fetchCount++;

    data = await fetchData(typeUrl);
    // Extract groups from the merged result
    groupsArray = data?._links?.groups || [];
    if (VERBOSE) console.log(`Found ${groupsArray.length} ${typeName} groups`);
    // テストモードの場合、shortnameでフィルタリング
    if (testGroupShortNames && Array.isArray(testGroupShortNames)) {
      groupsArray = groupsArray.filter(g => {
        const href = g.href || '';
        return testGroupShortNames.some(shortname => href.includes(`/${typeName.toLowerCase()}/${shortname}`));
      });
      console.log(`Filtered for testShortNames: ${testGroupShortNames.join(', ')} → ${groupsArray.length} groups`);
    }
    if (VERBOSE) console.log(`    ✓ ${typeName} list fetched`);
    fetchedCount++;
  } catch (e) {
    console.error(`Failed to fetch ${typeName} list: ${e.message}`);
    fetchCount++;

    data = {
      "_error": String(e)
    }
  }
  collectedTypeGroupsData[typeUrl] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };

  for (let i = 0; i < groupsArray.length; i++) {
    const g = groupsArray[i];
    const groupName = g.title || g.name || g.id || 'unknown';
    logAlways(`[${i + 1}/${groupsArray.length}] Processing: ${groupName}`);
    const groupHref = g.href;
    let urls = new Set();
    if (groupHref) {
      let groupData = {};
      // Fetch group details
      try {
        if (VERBOSE) console.log(`  → Fetching group data from ${groupHref}`);
        fetchCount++;

        groupData = await fetchData(groupHref);

        const partHref = groupData._links?.participations?.href;
        if (partHref) {
          urls.add(partHref);
        }
        const usersHref = groupData._links?.users?.href;
        if (usersHref) {
          urls.add(usersHref);
        }
        if (VERBOSE) console.log(`    ✓ Group data fetched from ${groupHref}`);
        fetchedCount++;
      } catch (e) {
        console.warn(`  error fetching group data ${groupHref}: ${String(e)}`);
        errorCount++;

        groupData = { _error: String(e) };
      }
      collectedTypeGroupsData[groupHref] = {
        fetchedAt: new Date().toISOString(),
        data: groupData
      }
    }

    // Fetch the urls for the group
    const urlsArray = Array.from(urls);
    console.log(`  Found ${urlsArray.length} data URLs to fetch for group`);
    for (let j = 0; j < urlsArray.length; j++) {

      const url = urlsArray[j];
      let data = {}
      try {
        if (VERBOSE) console.log(`  → Fetching data from ${url}`);
        fetchCount++;

        data = await fetchData(url)

        if (VERBOSE) console.log(`    ✓ Data  fetched from ${url}`);
        fetchedCount++;
      } catch (e) {
        console.warn(`  error fetching ${url}: ${String(e)}`);
        errorCount++;
        data = { "_error": String(e) };
      }
      collectedTypeGroupsData[url] = {
        fetchedAt: new Date().toISOString(),
        data: data
      }
    }
    // 100件ごとにProgress
    if (fetchCount % 100 === 0 || i === groupsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${groupsArray.length} fetches (${formatDuration(duration)})`);
    }
  }
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} groups data (Errors: ${errorCount})`);
  return collectedTypeGroupsData;
}

async function fetchParticipations(collectedGroupsData, collectedParticipationsData) {
  console.log('Start fetching Participations');
  // w3c-groups.jsonから全participationsのリストを抽出
  const allParticipationsSet = new Set();
  for (const url in collectedGroupsData) {
    const entry = collectedGroupsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    // _links.participationsがオブジェクトかつhrefが/participationsで終わる場合のみ抽出
    if (
      data._links &&
      data._links.participations &&
      typeof data._links.participations === 'object' &&
      !Array.isArray(data._links.participations) &&
      typeof data._links.participations.href === 'string' &&
      /\/participations$/.test(data._links.participations.href)
    ) {
      allParticipationsSet.add(data._links.participations.href);
    }
  }
  // 抽出した全participationsリストをfetch
  const allParticipationsArray = Array.from(allParticipationsSet);
  const participations = new Set();
  console.log(`Found ${allParticipationsArray.length} participation data to fetch`);
  let fetchedCount = 0;
  let errorCount = 0;
  let fetchCount = 0;
  for (let i = 0; i < allParticipationsArray.length; i++) {
    console.log(`[${i + 1}/${allParticipationsArray.length}] Processing: ${allParticipationsArray[i]}`);
    const partHref = allParticipationsArray[i];
    // 1. リストページ（/groups/.../participations）をfetch
    let detailData = {};
    try {
      if (VERBOSE) console.log(`  → Fetching participation list from ${partHref}`);
      fetchCount++;

      detailData = await fetchData(partHref);
      const participationsObj = detailData && detailData._links && detailData._links.participations;
      if (participationsObj && typeof participationsObj === 'object') {
        for (const key in participationsObj) {
          const p = participationsObj[key];
          if (p && p.href && /^https:\/\/api\.w3\.org\/participations\/.+/.test(p.href)) {
            participations.add(p.href);
          }
        }
      }
      if (VERBOSE) console.log(`    ✓ Participation list fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching participation list ${partHref}: ${String(e)}`);
      errorCount++;

      detailData = { _error: String(e) };
    }
    collectedParticipationsData[partHref] = {
      fetchedAt: new Date().toISOString(),
      data: detailData
    };
    // 進捗表示（100件ごと, 最後の1件）
    if (i % 100 === 0 || i === allParticipationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${allParticipationsArray.length} fetches (${formatDuration(duration)}) ---`);
    }
  }

  const participationsArray = Array.from(participations);
  console.log(`Found ${participationsArray.length} participations to fetch`);
  const participants = new Set();
  for (let i = 0; i < participationsArray.length; i++) {
    const participationHref = participationsArray[i];
    if (VERBOSE) console.log(`[${fetchCount + 1}] Fetching: ${participationHref}`);
    let participationData = {};
    try {
      if (VERBOSE) console.log(`  → Fetching participation detail from ${participationHref}`);
      fetchCount++;

      participationData = await fetchData(participationHref);
      collectedParticipationsData[participationHref] = {
        fetchedAt: new Date().toISOString(),
        data: participationData !== undefined ? participationData : { _error: 'Failed to fetch participation detail' }
      };
      // 組織参加の場合（individual === false）で _links.participants.href があれば追加
      if (participationData && participationData.individual === false && participationData._links && participationData._links.participants && typeof participationData._links.participants.href === 'string') {
        participants.add(participationData._links.participants.href);
      }

      if (VERBOSE) console.log(`    ✓ Participation detail fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`    error fetching participation detail ${participationHref}: ${String(e)}`);
      errorCount++;

      participationData = { _error: String(e) };
    }
    collectedParticipationsData[participationHref] = {
      fetchedAt: new Date().toISOString(),
      data: participationData
    };

    // 進捗表示（100件ごと, 最後の1件）
    if (i % 100 === 0 || i === participationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${participationsArray.length} fetches (${formatDuration(duration)}) ---`);
    }
  }
  // Fetch participants for organization participations (individual=false)
  const participantsArray = Array.from(participants);
  console.log(`Found ${participantsArray.length} participants data to fetch`);
  for (let i = 0; i < participantsArray.length; i++) {
    const participantsHref = participantsArray[i];
    if (VERBOSE) console.log(`[${fetchCount + 1}] Fetching: ${participantsHref}`);

    let participantsData = {};
    try {
      if (VERBOSE) console.log(`[${fetchCount}] Fetching: ${participantsHref}`);
      fetchCount++;

      participantsData = await fetchData(participantsHref);

      if (VERBOSE) console.log(`    ✓ Participants data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching participant data ${participantsHref}: ${String(e)}`);
      errorCount++;

      participantsData = { _error: String(e) };
    }
    collectedParticipationsData[participantsHref] = {
      fetchedAt: new Date().toISOString(),
      data: participantsData
    };
    // 進捗表示（100件ごと, 最後の1件）
    if (i % 100 === 0 || i === participantsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${participantsArray.length} fetches (${formatDuration(duration)}) ---`);
    }
  }
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} participations data (Errors: ${errorCount})`);
  return collectedParticipationsData;
}

async function fetchUsers(collectedGroupsData, collectedParticipationsData) {
  console.log('Start fetching Users');
  // usersデータ格納用オブジェクトを初期化
  let collectedUsersData = {};
  const allUsers = new Set();

  // groupsの/usersエンドポイントからもユーザーURLを抽出
  if (collectedGroupsData) {
    for (const url in collectedGroupsData) {
      const entry = collectedGroupsData[url];
      if (!entry || !entry.data) continue;
      const data = entry.data;
      if (data._links && data._links.users) {
        const users = data._links.users;
        if (Array.isArray(users)) {
          for (const user of users) {
            if (user && user.href && user.href.includes('/users/')) {
              allUsers.add(user.href);
            }
          }
        } else if (users && typeof users === 'object') {
          for (const user of Object.values(users)) {
            if (user && user.href && user.href.includes('/users/')) {
              allUsers.add(user.href);
            }
          }
        }
      }
    }
  }
  // participationsから全てのユーザーを抽出
  for (const url in collectedParticipationsData) {
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    // links.userがある場合はそのhrefを追加
    if (data._links && data._links.user && data._links.user.href) {
      allUsers.add(data._links.user.href);
    }
    // /participantsで終わる場合はparticipantsの中のhrefが/users/で始まるものだけ追加
    if (url.endsWith('/participants') && data._links && data._links.participants) {
      const participants = data._links.participants;
      if (Array.isArray(participants)) {
        for (const participant of participants) {
          if (participant && participant.href && participant.href.includes('/users/')) {
            allUsers.add(participant.href);
          }
        }
      } else if (participants && typeof participants === 'object') {
        for (const participant of Object.values(participants)) {
          if (participant && participant.href && participant.href.includes('/users/')) {
            allUsers.add(participant.href);
          }
        }
      }
    }
  }
  // 抽出した全ユーザーURLを配列化してfetch
  const allUsersArray = Array.from(allUsers);
  const userAfflications = new Set();
  const userGroups = new Set();
  let fetchCount = 0, fetchedCount = 0, errorCount = 0;
  console.log(`Found ${allUsersArray.length} users to fetch`);
  for (let i = 0; i < allUsersArray.length; i++) {
    const userHref = allUsersArray[i];
    if (VERBOSE) {
      console.log(`[${i + 1}/${allUsersArray.length}] Fetching: ${userHref}`);
    }
    if (userHref) {
      let userData = {};
      try {
        if (VERBOSE) console.log(`  → Fetching user data from ${userHref}`);
        fetchCount++;

        // 全Phaseで[REQUEST][RESPONSE]を出す（SUPPRESS_REQUEST_LOGは使わない）
        userData = await fetchData(userHref);
        if (userData && userData._links && userData._links.affiliations) {
          // affiliationsが配列の場合
          if (Array.isArray(userData._links.affiliations)) {
            for (const aff of userData._links.affiliations) {
              if (aff && aff.href) {
                userAfflications.add(aff.href);
              }
            }
          } else if (typeof userData._links.affiliations === 'object' && userData._links.affiliations.href) {
            userAfflications.add(userData._links.affiliations.href);
          }
        }
        if (userData && userData._links && userData._links.groups) {
          if (Array.isArray(userData._links.groups)) {
            for (const grp of userData._links.groups) {
              if (grp && grp.href) {
                userGroups.add(grp.href);
              }
            }
          } else if (typeof userData._links.groups === 'object' && userData._links.groups.href) {
            userGroups.add(userData._links.groups.href);
          }
        }
        if (VERBOSE) {
          console.log(`    ✓ Fetched user data`);
        }
        fetchedCount++
      } catch (e) {
        console.warn(`  error fetching user data ${userHref}: ${String(e)}`);
        errorCount++;

        userData = {
          error: String(e)
        }
      }
      collectedUsersData[userHref] = {
        fetchedAt: new Date().toISOString(),
        data: userData
      };
    }
    // 進捗表示（100件ごと、または最後）
    if (i % 100 === 0 || i === allUsersArray.length - 1) {
      console.log(`    --- Progress: ${i + 1}/${allUsersArray.length} user data (${formatDuration(Date.now() - fetchStartTimestamp)})`);
    }
  }
  const userAfflicationsArray = Array.from(userAfflications);
  console.log(`Found ${userAfflicationsArray.length} user affiliations to fetch`);
  for (let i = 0; i < userAfflicationsArray.length; i++) {
    const affHref = userAfflicationsArray[i];
    let affData = {};
    try {
      if (VERBOSE) console.log(`[${i + 1}/${userAfflicationsArray.length}] Fetching: ${affHref}`);
      fetchCount++;

      affData = await fetchData(affHref);

      if (VERBOSE) console.log(`    ✓ user affiliation data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching user affiliation data ${affHref}: ${String(e)}`);
      errorCount++;

      affData = { error: String(e) };
    }
    collectedUsersData[affHref] = {
      fetchedAt: new Date().toISOString(),
      data: affData
    };

    if (fetchCount % 100 === 0 || i === userAfflicationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${userAfflicationsArray.length} user affiliations (${formatDuration(duration)})`);
    }
  }

  const userGroupsArray = Array.from(userGroups);
  console.log(`Found ${userGroupsArray.length} user groups to fetch`);
  for (let i = 0; i < userGroupsArray.length; i++) {
    const groupHref = userGroupsArray[i];
    let groupData = {};
    try {
      if (VERBOSE) console.log(`[${i + 1}/${userGroupsArray.length}] Fetching: ${groupHref}`);
      fetchCount++;

      groupData = await fetchData(groupHref);

      if (VERBOSE) console.log(`    ✓ user group data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching user group group data ${groupHref}: ${String(e)}`);
      errorCount++;

      groupData = { error: String(e) };
    }
    collectedUsersData[groupHref] = {
      fetchedAt: new Date().toISOString(),
      data: groupData
    };

    if (fetchCount % 100 === 0 || i === userGroupsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${userGroupsArray.length} groups (${formatDuration(duration)})`);
    }
  }

  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} users data (Errors: ${errorCount})`);
  return collectedUsersData;
}

async function fetchAffiliations(collectedParticipationsData, collectedUsersData) {
  console.log('start fetching Affiliations');
  // affiliationsデータ格納用オブジェクトを初期化
  let collectedAffiliationsData = {};
  const allAffiliations = new Set();
  // 1. participationsからorganization affiliationを抽出
  for (const url in collectedParticipationsData) {
    if (url.endsWith('/participants')) continue; // participantsのデータは除外
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    if (data._links && data._links.organization && data._links.organization.href) {
      allAffiliations.add(data._links.organization.href);
    }
  }
  // 2. usersのaffiliationsエンドポイントから_links.affiliations配下のhrefを抽出（配列・オブジェクト両対応）
  for (const url in collectedUsersData) {
    if (!url.endsWith('/affiliations')) continue; // affiliationsのデータのみ対象
    const entry = collectedUsersData[url];
    // 2重構造対応: { [url]: { [url]: { data: ... } } } の場合も考慮
    let data = entry && entry.data;
    if (!data && entry && typeof entry === 'object') {
      // 2重構造: entry[url].data
      if (entry[url] && entry[url].data) {
        data = entry[url].data;
      }
    }
    if (!data) continue;
    if (data._links && data._links.affiliations) {
      const affiliations = data._links.affiliations;
      if (Array.isArray(affiliations)) {
        for (const aff of affiliations) {
          if (aff && aff.href) {
            allAffiliations.add(aff.href);
          }
        }
      } else if (typeof affiliations === 'object') {
        for (const key of Object.keys(affiliations)) {
          const aff = affiliations[key];
          if (aff && aff.href) {
            allAffiliations.add(aff.href);
          }
        }
      }
    }
  }
  // 抽出した全affiliationsをfetch
  let fetchCount = 0, fetchedCount = 0, errorCount = 0;
  const allAffiliationsArray = Array.from(allAffiliations);
  console.log(`Found ${allAffiliationsArray.length} affiliations to fetch`);
  for (let i = 0; i < allAffiliationsArray.length; i++) {
    const affHref = allAffiliationsArray[i];
    let affData = {};
    try {
      if (VERBOSE) console.log(`[${i + 1}/${allAffiliationsArray.length}] Fetching affiliation: ${affHref}`);
      fetchCount++;

      affData = await fetchData(affHref);

      if (VERBOSE) console.log(`    ✓ affiliation data fetched`);
      fetchedCount++;
    } catch (e) {
      if (VERBOSE) {
        console.warn(`error fetching affiliation ${affHref}: ${String(e)}`);
      }
      errorCount++;

      affData = { error: String(e) };
    }
    collectedAffiliationsData[affHref] = {
      fetchedAt: new Date().toISOString(),
      data: affData
    };

    if (i % 100 === 0 || i === allAffiliationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${allAffiliationsArray.length} affiliations (${formatDuration(duration)})`);
    }
  }
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} affiliations data (Errors: ${errorCount})`);
  return collectedAffiliationsData;
}


async function phase1_fetchGroupsParticipationsUsers(dirPath, groupsFilename, isTestMode) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
  // shouldFetchGroupsはmainで判定。isTestModeのみ引数で受け取る。
  logAlways('\n========== PHASE 1: Fetching Groups, Participations List, and Users list ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  let collectedGroupsData = {};
  let testGroupsShortNamesMap = {};  // テストでのtypeごとのshortname配列を格納するオブジェクト
  if (isTestMode) {
    // typeごとにshortnameリストを作成
    for (const { type, shortname } of testGroups) {
      if (!testGroupsShortNamesMap[type]) testGroupsShortNamesMap[type] = [];
      testGroupsShortNamesMap[type].push(shortname);
    }
    logAlways(`Running in TEST mode - fetching ${testGroups.length} sample groups\n`);
  }
  // groupをフェッチ
  const groupTypes = ['wg', 'ig', 'cg', 'tf', 'other'];
  for (let i = 0; i < groupTypes.length; i++) {
    const type = groupTypes[i];
    const testGroupShortNames = testGroupsShortNamesMap[type];　// テストモード時のみshortname配列を渡す
    if (isTestMode && testGroupShortNames == undefined) {
      // テストモードでかつ該当typeのshortnameがundefinedの場合はスキップ
      continue;
    }
    // logAlwaysはfetchTypeGroups側で出力するため、ここでは出さない
    const typeGroupsData = await fetchTypeGroups(type, testGroupShortNames);
    Object.assign(collectedGroupsData, typeGroupsData);
  }
  logAlways(`\n========== PHASE 1 Summary ==========`);
  // 全グループ数（リストページから集計）
  let totalGroupCount = 0;
  for (const key of Object.keys(collectedGroupsData)) {
    if (/\/groups\/(wg|ig|cg|tf|other)$/.test(key)) {
      const entry = collectedGroupsData[key];
      if (entry && entry.data && entry.data._links && Array.isArray(entry.data._links.groups)) {
        totalGroupCount += entry.data._links.groups.length;
      }
    }
  }
  // テストモード時のテストグループ数
  let testedGroupsCount = 0;
  if (isTestMode) {
    for (const key of Object.keys(collectedGroupsData)) {
      if (/\/groups\/(wg|ig|cg|tf|other)\/[a-zA-Z0-9\-]+$/.test(key)) {
        testedGroupsCount++;
      }
    }
  }
  logAlways(`Total group: ${totalGroupCount}`);
  if (isTestMode) {
    logAlways(`Total groups fetched (Test Mode) : ${testedGroupsCount}`);
  }
  logAlways(`Total groups data collected: ${Object.keys(collectedGroupsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[0] = phaseRequestCount;
  const phase1Written = await compareAndWriteJson(dirPath, groupsFilename, collectedGroupsData);
  if (phase1Written) {
    logAlways('✓ The latest Groups data successfully saved.');
  }
}

async function phase2_fetchParticipations(dirPath, groupsFilename, participationFilename) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
  const participationFilePath = dirPath + '/' + participationFilename;
  logAlways('\n========== PHASE 2: Fetching Participations ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  // groupsデータを都度ロード
  let collectedGroupsData = {};
  try {
    const groupsContent = fs.readFileSync(groupsFilePath, 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json`);
  } catch (e) {
    console.error(`Error: Cannot load ${groupsFilePath}: ${e.message}`);
    process.exit(1);
  }
  // participationデータは空で開始
  let collectedParticipationsData = await fetchParticipations(collectedGroupsData, {});
  logAlways(`\n========== PHASE 2 Summary ==========`);
  logAlways(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[1] = phaseRequestCount;
  const phase2Written = await compareAndWriteJson(dirPath, participationFilename, collectedParticipationsData);
  if (phase2Written) {
    logAlways('✓ The latest Participations data successfully saved.');
  }
}

async function phase3_fetchUsers(dirPath, groupsFilename, participationFilename, usersFilename) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
  const participationFilePath = dirPath + '/' + participationFilename;
  logAlways('\n========== PHASE 3: Fetching Users ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  let collectedGroupsData = {};
  let collectedParticipationsData = {};

  // groupsデータロード
  try {
    const groupsContent = fs.readFileSync(groupsFilePath, 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
    process.exit(1);
  }

  // participationsデータを都度ロード
  try {
    const participationsContent = fs.readFileSync(participationFilePath, 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
    process.exit(1);
  }

  // usersデータは空で開始
  let collectedUsersData = await fetchUsers(collectedGroupsData, collectedParticipationsData);
  logAlways(`\n========== PHASE 3 Summary ===========`);
  logAlways(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[2] = phaseRequestCount;
  const phase3Written = await compareAndWriteJson(dirPath, usersFilename, collectedUsersData);
  if (phase3Written) {
    logAlways('✓ The latest Users data successfully saved.');
  }
}

// （重複・壊れた定義を削除）
// PHASE 4: Affiliations
async function phase4_fetchAffiliations(dirPath, participationFilename, usersFilename, affiliationsFilename) {
  const participationFilePath = dirPath + '/' + participationFilename;
  const usersFilePath = dirPath + '/' + usersFilename;
  logAlways('\n========== PHASE 4: Fetching Affiliations ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();

  // participationsデータを都度ロード
  let collectedParticipationsData = {};
  try {
    const participationsContent = fs.readFileSync(participationFilePath, 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
    process.exit(1);
  }
  // usersデータを都度ロード
  let collectedUsersData = {};
  try {
    const usersContent = fs.readFileSync(usersFilePath, 'utf8');
    collectedUsersData = JSON.parse(usersContent);
    logAlways(`Loaded ${Object.keys(collectedUsersData).length} items from ${usersFilePath}`);
  } catch (e) {
    console.error(`Error: Cannot load ${usersFilePath}: ${e.message}`);
    process.exit(1);
  }
  const collectedAffiliationsData = await fetchAffiliations(collectedParticipationsData, collectedUsersData);
  logAlways(`\n========== PHASE 4 Summary ==========`);
  logAlways(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[3] = phaseRequestCount;
  const phase4Written = await compareAndWriteJson(dirPath, affiliationsFilename, collectedAffiliationsData);
  if (phase4Written) {
    logAlways('✓ The latest Affiliations data successfully saved.');
  }
}

function printUsage() {
  console.log(`\nUsage:
  node scripts/fetch-w3c-data.js                    # Fetch all data (groups + participations + users + affiliations)
  node scripts/fetch-w3c-data.js --groups --test     # Test mode (7 sample groups, groups phase only)
  node scripts/fetch-w3c-data.js --groups           # Fetch only groups, participations lists, users lists
  node scripts/fetch-w3c-data.js --participations   # Fetch only participation details (requires w3c-groups.json)
  node scripts/fetch-w3c-data.js --users            # Fetch only user details (requires w3c-participations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Fetch only affiliations (requires w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Fetch groups and participations
  node scripts/fetch-w3c-data.js --verbose          # Show detailed fetch logs\n`);
}

async function main() {
  const dirPath = './data';
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
  // 未対応の--option
  const unknownOptions = process.argv.slice(2).filter(opt => opt.startsWith('--') && !allowedOptions.includes(opt));
  // 未対応の-（シングルハイフン）オプション（-h以外）
  const unknownSingleOptions = process.argv.slice(2).filter(opt => opt.startsWith('-') && !opt.startsWith('--') && opt !== '-h');
  if (unknownOptions.length > 0 || unknownSingleOptions.length > 0) {
    const allUnknown = [...unknownOptions, ...unknownSingleOptions];
    console.error(`Error: Unsupported option(s): ${allUnknown.join(', ')}`);
    printUsage();
    process.exit(1);
  }
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  fs.mkdirSync(dirPath, { recursive: true });
  const isTestMode = process.argv.includes('--test') || forceTestMode;
  const fetchGroups = process.argv.includes('--groups');
  const fetchParticipations = process.argv.includes('--participations');
  const fetchUsers = process.argv.includes('--users');
  const fetchAffiliations = process.argv.includes('--affiliations');
  const fetchAll = !fetchGroups && !fetchParticipations && !fetchUsers && !fetchAffiliations;

  const fileNames = {
    data: 'w3c-data.json',
    groups: 'w3c-groups.json',
    participations: 'w3c-participations.json',
    users: 'w3c-users.json',
    affiliations: 'w3c-affiliations.json'
  };
  const nowIso = new Date().toISOString();
  const usedFiles = new Set();

  if (fetchAll || fetchGroups) {
    usedFiles.add(fileNames['groups']);
    await phase1_fetchGroupsParticipationsUsers(dirPath, fileNames['groups'], isTestMode);
  }
  if (fetchAll || fetchParticipations) {
    usedFiles.add(fileNames['groups'])
    usedFiles.add(fileNames['participations']);
    await phase2_fetchParticipations(dirPath, fileNames['groups'], fileNames['participations']);
  }
  if (fetchAll || fetchUsers) {
    usedFiles.add(fileNames['groups']);
    usedFiles.add(fileNames['participations']);
    usedFiles.add(fileNames['users']);
    await phase3_fetchUsers(dirPath, fileNames['groups'], fileNames['participations'], fileNames['users']);
  }
  if (fetchAll || fetchAffiliations) {
    usedFiles.add(fileNames['users']);
    usedFiles.add(fileNames['participations']);
    usedFiles.add(fileNames['affiliations']);
    await phase4_fetchAffiliations(dirPath, fileNames['participations'], fileNames['users'], fileNames['affiliations']);
  }

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== All Summary ==========`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  // トータルリクエスト数と平均
  console.log(`Total requests (all phases): ${totalRequestCount}`);
  const totalDurationSec = duration / 1000;
  console.log(`Average requests/sec (all phases): ${(totalRequestCount / totalDurationSec).toFixed(2)}`);

  // w3c-data.json生成処理
  // files配列構築
  const files = [];

  for (const filename of Array.from(usedFiles)) {
    let path = dirPath + '/' + filename;
    try {
      const content = fs.readFileSync(path, 'utf8');
      const json = JSON.parse(content);
      if (!json._metadata) {
        console.warn(`Warning: Missing _metadata in ${path}`);
        continue;
      }
      files.push({ _metadata: json._metadata });
    } catch (e) {
      console.error(`Error reading/parsing ${path}: ${e.message}`);
    }
  }
  const w3cData = {
    _metadata: {
      filename: fileNames['data'],
      lastChecked: nowIso
    },
    files
  };
  const path = dirPath + '/' + fileNames['data'];
  fs.writeFileSync(path, JSON.stringify(w3cData, null, 2), 'utf8');
  console.log(`✓ ${path} updated`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
