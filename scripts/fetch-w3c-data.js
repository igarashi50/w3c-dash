// 先頭でデータ用変数を宣言
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

// minimist不要: シンプルなフラグ判定
const VERBOSE = process.argv.includes('--verbose');
function logAlways(msg) { console.log(msg); }
function logVerbose(msg) { if (VERBOSE) console.log(msg); }

// グローバル変数廃止。各Phase関数で都度ファイルロード・ローカル変数化。
let fetchStartTime = ''; // 取得開始時刻（表示用）
let fetchStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）p
let phaseRequestCount = 0; // 各PhaseのfetchJson呼び出し回数
let phaseStartTimestamp = 0; // 各Phaseの開始時刻
let totalRequestCount = 0; // 全体のfetchJson呼び出し回数
let phaseRequestCounts = []; // 各Phaseごとのリクエスト数

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
const REQUEST_INTERVAL = 200;


forceTestMode = false;   // 本番はこっち
// forceTestMode = true;   // テストモードフラグ
// typeごとにshortname配列をまとめる
const testGroupsOld = [
  { type: 'wg', shortname: 'css' },
  //{ type: 'wg', shortname: 'miniapps' },
  { type: 'wg', shortname: 'did' },
  { type: 'wg', shortname: 'wot' },
  { type: 'ig', shortname: 'i18n' },
  //{ type: 'cg', shortname: 'global-inclusion' },
  { type: 'tf', shortname: 'ab-elected' },
  { type: 'other', shortname: 'ab' }
];

const testGroups = [  // minimal set for quick tests
  //{type: 'wg', shortname: 'dx'},
  { type: 'wg', shortname: 'data-shapes' },
  { type: 'ig', shortname: 'wai' },
  { type: 'cg', shortname: 'ixml' },
  { type: 'tf', shortname: 'ab-elected' },
  { type: 'other', shortname: 'ab' },
]


const reGroupsParticipations = /^https:\/\/api\.w3\.org\/groups\/[^\/]+\/[^\/]+\/participations$/;
const reGroupsUsers = /^https:\/\/api\.w3\.org\/groups\/[^\/]+\/[^\/]+\/users$/;
const reParticipationsParticipants = /^https:\/\/api\.w3\.org\/participations\/[^\/]+\/participants$/;
const reUsersAffiliations = /^https:\/\/api\.w3\.org\/users\/[^\/]+\/affiliations$/;
const reUsersGroups = /^https:\/\/api\.w3\.org\/users\/[^\/]+\/groups$/;
const reUsers = /^https:\/\/api\.w3\.org\/users\/[^\/]+$/;
const reAffiliations = /^https:\/\/api\.w3\.org\/affiliations\/[^\/]+$/;

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
            // dataが同じなら古いfetchedAtとlastModifiedを使う
            mergedData[k] = { ...newEntry, fetchedAt: prevEntry.fetchedAt, lastModified: prevEntry.lastModified };
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
    return false; // not finished
  }
  // データが変わっていない場合はファイル保存を行わない
  if (!hasChanges) {
    console.log(`✓ No changes detected: ${filePath} not updated.`);
  } else {
    const finalDataWithMetadata = {
      _metadata: {
        filename: filename,
        lastChecked: new Date(fetchStartTimestamp).toUTCString(), // HTTP-date
        fetchStartTime: fetchStartTime,
        duration: durationStr,
        itemCount: Object.keys(mergedData).length
      },
      ...mergedData
    };
    const finalContent = JSON.stringify(finalDataWithMetadata, null, 2);
    fs.writeFileSync(filePath, finalContent, 'utf8');
    console.log(`✓ File updated with data changes: ${filePath}`);
  }
  return true;  // finished
};

function fetchJson(url, retries = 6, backoffMs = 60000, timeoutMs = 180000, redirects = 5, verbose = false) {
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

      if (verbose) console.log(`    [REQUEST] ${url}`);
      const req = lib.get(url, { headers, timeout: timeoutMs }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && redirects > 0 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchJson(next, retries, backoffMs, timeoutMs, redirects - 1, verbose));
        }

        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', async () => {
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();

          // [RESPONSE] ログ出力（status, content-length, Last-Modified）
          if (verbose) {
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
              return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects, verbose).then(resolve).catch(reject);
            }
            // 5xx系はリトライ対象
            if (res.statusCode >= 500 && res.statusCode < 600 && retries > 0) {
              const retryNum = 7 - retries;
              const msg = `[RETRY] ${url} (HTTP ${res.statusCode}) (${retryNum}/6) wait ${backoffMs}ms`;
              if (verbose) {
                console.warn(msg + ` [RESPONSE BODY]`);
              } else {
                console.warn(msg);
              }
              await new Promise(r => setTimeout(r, backoffMs));
              return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects, verbose).then(resolve).catch(reject);
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
            const notJsonResult = {
              e: "Not JSON response",  // e is specified error message
              url,
              statusCode: res.statusCode,
              headers: res.headers,
              message: `HTTP error ${res.statusCode}`,
              body: bodyText
            };
            return reject(notJsonResult);
          }

          const finish = (buf) => {
            try {
              const text = buf.toString('utf8');
              const data = JSON.parse(text);
              const result = {
                lastModified: res.headers['last-modified'] || null,
                data: data
              }
              return resolve(result);
            } catch (e) {
              // パース失敗時はテキストも記録
              const errorDetail = {
                error: e,  // e is specified error message
                url,
                statusCode: res.statusCode,
                headers: res.headers,
                rawText: buf.toString('utf8')
              }
              return reject(errorDetail);
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
        const msg = `    [RETRY] request error for ${url}: message=${err.message} code=${err.code || ''} (retry ${retryNum}/6)`;
        if (retries > 0) {
          if (verbose) {
            console.warn(msg + ` stack=${err.stack || ''}`);
          } else {
            console.warn(msg);
          }
          const wait = backoffMs;
          console.warn(`    [RETRY] ${url} (${retryNum}/6) wait ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          return fetchJson(url, retries - 1, Math.round(backoffMs * 1.5), timeoutMs, redirects, verbose).then(resolve).catch(reject);
        }
        // JSONにも詳細を記録
        reject({
          e: err.message,   // e is specified error message
          url,
          code: err.code,
          stack: err.stack,
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

// fetchApiData is the exactly same in w3c-api.js and  fetch-data.js 
async function fetchApiData(startUrl, verbose = false) {
  if (!startUrl) return undefined;

  const pages = [];
  let url = startUrl;
  if (url.endsWith('/')) url = url.slice(0, -1);
  // items=500を常に付与
  if (!url.includes('items=')) {
    url += (url.includes('?') ? '&' : '?') + 'items=500';
  }
  let page = 1; // 初期ページ
  let lastModified = null;
  while (url) {
    let fetchStart = Date.now();
    let fetchEnd;
    try {
      const result = await fetchJson(url, 6, 60000, 120000, 5, verbose);
      if (result.data == undefined) {
        throw new Error(`No data in response for ${url}`);
      }
      const data = result.data;
      pages.push(data);
      if (lastModified == null) {
        lastModified = result.lastModified;
      }
      // レスポンスから総ページ数を取得して次のURLを構築
      const totalPages = data.pages || 1;
      if (page < totalPages) {
        page += 1;
        let baseUrl = startUrl.split('?')[0];
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        // items=500とpageを両方付与
        url = `${baseUrl}?items=500&page=${page}`;
      } else {
        url = null; // 最後のページに到達
      }
    } catch (err) {
      console.log(`    [ERROR] fetchApiData error for ${url}: ${JSON.stringify(err).substring(0, 200)}`);
      throw (err);
    } finally {
      fetchEnd = Date.now();
    }
    const elapsed = fetchEnd - fetchStart;
    const sleepMs = REQUEST_INTERVAL - elapsed;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
    if (verbose) { console.log(`    [INFO] elapsed ${elapsed}ms  sleep ${sleepMs}ms`); }
  }

  let data = undefined;
  if (pages.length === 1) {   // ページが1つだけの場合
    data = pages[0];
  } else {
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

      data = merged // 複数のページのデータをマージした結果
    } else {
      throw (Error('cannot fetch any pages'));
    }
  }

  const ret = {
    lastModified: lastModified,
    data: data,
  };

  return ret
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
  let dataEntry = {
    fetchedAt: new Date().toUTCString(), // HTTP date format
    lastModified: undefined,
    data: undefined
  }
  try {
    if (VERBOSE) console.log(`  → Fetching data from ${typeUrl}`);
    fetchCount++;

    const { lastModified, data } = await fetchApiData(typeUrl, VERBOSE);
    dataEntry.lastModified = lastModified;
    dataEntry.data = data;

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
    errorCount++;

    dataEntry.data = { _error: String(e) };
  }
  collectedTypeGroupsData[typeUrl] = dataEntry;

  for (let i = 0; i < groupsArray.length; i++) {
    const g = groupsArray[i];
    const groupName = g.title || g.name || g.id || 'unknown';
    // logAlways(`[${i + 1}/${groupsArray.length}] Processing: ${groupName}`);
    const groupHref = g.href;
    let urls = new Set();
    if (groupHref) {
      let dataEntry = {
        fetchedAt: new Date().toUTCString(), // HTTP date format
        lastModified: undefined,
        data: undefined
      }
      // Fetch group details
      try {
        if (VERBOSE) console.log(`  → Fetching group data from ${groupHref}`);
        fetchCount++;

        const { lastModified, data } = await fetchApiData(groupHref, VERBOSE);
        dataEntry.lastModified = lastModified;
        dataEntry.data = data;

        const partHref = data._links?.participations?.href;
        if (partHref) {   // https://api.w3.org/groups/{type}/{shortname}/participations
          if (!reGroupsParticipations.test(partHref)) {
            console.warn(`Warning: Unexpected groups participations URL format: ${partHref}`);
          }
          urls.add(partHref);
        }
        const usersHref = data._links?.users?.href;
        if (usersHref) {   // https://api.w3.org/groups/{type}/{shortname}/users
          if (!reGroupsUsers.test(usersHref)) {
            console.warn(`Warning: Unexpected groups users URL format: ${usersHref}`);
          }
          urls.add(usersHref);
        }
        if (VERBOSE) console.log(`    ✓ Group data fetched from ${groupHref}`);
        fetchedCount++;
      } catch (e) {
        console.warn(`  error fetching group data ${groupHref}: ${String(e)}`);
        errorCount++;

        dataEntry.data = { _error: String(e) };
      }
      collectedTypeGroupsData[groupHref] = dataEntry;
    }

    // Fetch the urls for the group
    const urlsArray = Array.from(urls);
    console.log(`  Found ${urlsArray.length} data URLs to fetch for group`);
    for (let j = 0; j < urlsArray.length; j++) {
      const url = urlsArray[j];
      let dataEntry = {
        fetchedAt: new Date().toUTCString(), // HTTP-date形式
        lastModified: undefined,
        data: undefined
      }
      try {
        if (VERBOSE) console.log(`  → Fetching data from ${url}`);
        fetchCount++;

        const { lastModified, data } = await fetchApiData(url, VERBOSE);
        dataEntry.lastModified = lastModified;
        dataEntry.data = data;

        if (VERBOSE) console.log(`    ✓ Data  fetched from ${url}`);
        fetchedCount++;
      } catch (e) {
        console.warn(`  error fetching ${url}: ${String(e)}`);
        errorCount++;
        dataEntry.data = { "_error": String(e) };
      }
      collectedTypeGroupsData[url] = dataEntry
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
    if (
      data._links &&
      data._links.participations &&
      typeof data._links.participations === 'object' &&
      !Array.isArray(data._links.participations) &&
      typeof data._links.participations.href === 'string'
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
    const partHref = allParticipationsArray[i];  // 
    // 1. リストページ（/groups/.../participations）をfetch
    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`  → Fetching participation list from ${partHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(partHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      const participationsObj = data._links && data._links.participations;
      if (participationsObj && typeof participationsObj === 'object') {
        for (const key in participationsObj) {   // https://api.w3.org/groups/{type}/{shortname}/participations
          const p = participationsObj[key];
          participations.add(p.href);
        }
      }
      if (VERBOSE) console.log(`    ✓ Participation list fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching participation list ${partHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { _error: String(e) };
    }
    collectedParticipationsData[partHref] = dataEntry;

    // 進捗表示（100件ごと, 最後の1件）
    if (i % 100 === 0 || i === allParticipationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${allParticipationsArray.length} fetches (${formatDuration(duration)}) ---`);
    }
  }

  /// 2. 各participation詳細ページをfetch
  const participationsArray = Array.from(participations);
  console.log(`Found ${participationsArray.length} participations to fetch`);
  const participants = new Set();
  for (let i = 0; i < participationsArray.length; i++) {
    const participationHref = participationsArray[i];
    if (VERBOSE) console.log(`[${fetchCount + 1}] Fetching: ${participationHref}`);

    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`  → Fetching participation detail from ${participationHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(participationHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;
      collectedParticipationsData[participationHref] = dataEntry;
      // 組織参加の場合（individual === false）で _links.participants.href があれば追加
      if (dataEntry.data && dataEntry.data.individual === false && data._links && data._links.participants && typeof data._links.participants.href === 'string') {
        // https://api.w3.org/participations/{participation}/participants
        const href = data._links.participants.href;
        if (!reParticipationsParticipants.test(href)) {
          console.warn(`Warning: Unexpected participation participants URL format: ${href}`);
        }
        participants.add(href);
      }

      if (VERBOSE) console.log(`    ✓ Participation detail fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`    error fetching participation detail ${participationHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { _error: String(e) };
    }
    collectedParticipationsData[participationHref] = dataEntry;

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

    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`[${fetchCount}] Fetching: ${participantsHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(participantsHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      if (VERBOSE) console.log(`    ✓ Participants data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching participant data ${participantsHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { _error: String(e) };
    }
    collectedParticipationsData[participantsHref] = dataEntry;
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

  // groupsの/usersエンドポイントからもユーザーURLを抽出, これはCGの個人参加の人、例外のIGのメンバーも含まれる
  const usersFromGroups = new Set();
  if (collectedGroupsData) {
    for (const url in collectedGroupsData) {
      if (!reGroupsUsers.test(url)) {
        // console.log(`Skipping non-/users URL: ${url}`);
        continue;
      }
      const entry = collectedGroupsData[url];
      if (!entry || !entry.data) continue;
      const data = entry.data;
      // links.usersがある場合はそのhrefを追加
      if (data._links && data._links.users) {
        const users = data._links.users;
        if (Array.isArray(users)) {
          // https://api.w3.org/users/{hash}
          for (const user of users) {
            if (user && user.href) {
              usersFromGroups.add(user.href);
            }
          }
        } else if (users && typeof users === 'object') {
          for (const user of Object.values(users)) {
            if (user && user.href) {
              usersFromGroups.add(user.href);
            }
          }
        }
      }
    }
  }
  // participationsから全てのユーザーを抽出、Groupsに参加する組織メンバーは取得
  const usersFromParticipants = new Set();
  for (const url in collectedParticipationsData) {
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    // links.userがある場合はそのhrefを追加

    if (data._links && data._links.user && data._links.user.href) {
      // https://api.w3.org/users/${hash}
      usersFromParticipants.add(data._links.user.href);
    }

    // /participantsで終わる場合はparticipantsの中のhrefが/users/で始まるものだけ追加
    if (url.endsWith('/participants') && data._links && data._links.participants) {
      const participants = data._links.participants;
      if (Array.isArray(participants)) {
        // e.g. https://api.w3.org/users/${hash}
        for (const participant of participants) {
          if (participant && participant.href) {
            usersFromParticipants.add(participant.href);
          }
        }
      } else if (participants && typeof participants === 'object') {
        // e.g. https://api.w3.org/users/${hash}
        for (const participant of Object.values(participants)) {
          if (participant && participant.href) {
            usersFromParticipants.add(participant.href);
          }
        }
      }
    }
  }

  // 抽出した全ユーザーURLを配列化してfetch
  console.log('Found users from groups: ' + usersFromGroups.size);
  console.log('Found users from participations: ' + usersFromParticipants.size);
  const allUsers = new Set([
    ...usersFromGroups,
    ...usersFromParticipants,
  ]);

  let collectedUsersData = await fetchUsersData(allUsers);

  return collectedUsersData;
}

async function fetchUsersData(allUsers) {
  let collectedUsersData = {}; // user Dataが収集されるて戻り値
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
      let dataEntry = {
        fetchedAt: new Date().toUTCString(), // HTTP-date形式
        lastModified: undefined,
        data: undefined
      }
      try {
        if (VERBOSE) console.log(`  → Fetching user data from ${userHref}`);
        fetchCount++;

        // 全Phaseで[REQUEST][RESPONSE]を出す
        const { lastModified, data } = await fetchApiData(userHref, VERBOSE);
        dataEntry.lastModified = lastModified;
        dataEntry.data = data;
        if (data && data._links && data._links.affiliations) {
          // affiliationsが配列の場合
          if (Array.isArray(data._links.affiliations)) {
            for (const aff of data._links.affiliations) {
              // e.g. https://api.w3.org/users/${hash}/affiliations
              if (aff && aff.href) {
                if (!reUsersAffiliations.test(aff.href)) {
                  console.warn(`Warning: Unexpected users affiliation URL format: ${aff.href}`);
                }
                userAfflications.add(aff.href);
              }
            }
          } else if (typeof data._links.affiliations === 'object' && data._links.affiliations.href) {
            //  https://api.w3.org/users/${hash}/affiliations
            if (!reUsersAffiliations.test(data._links.affiliations.href)) {
              console.warn(`Warning: Unexpected users affiliation URL format: ${data._links.affiliations.href}`);
            }
            userAfflications.add(data._links.affiliations.href);
          }
        }
        if (data && data._links && data._links.groups) {
          if (Array.isArray(data._links.groups)) {
            for (const grp of data._links.groups) {
              if (grp && grp.href) {
                // e.g. https://api.w3.org/users/${hash}/groups
                if (!reUsersGroups.test(grp.href)) {
                  console.warn(`Warning: Unexpected users groups URL format: ${grp.href}`);
                }
                userGroups.add(grp.href);
              }
            }
          } else if (typeof data._links.groups === 'object' && data._links.groups.href) {
            if (!reUsersGroups.test(data._links.groups.href)) {
              console.warn(`Warning: Unexpected users groups URL format: ${data._links.groups.href}`);
            }
            userGroups.add(data._links.groups.href);
          }
        }
        if (VERBOSE) {
          console.log(`    ✓ Fetched user data`);
        }
        fetchedCount++
      } catch (e) {
        console.warn(`  error fetching user data ${userHref}: ${String(e)}`);
        errorCount++;

        dataEntry.data = {
          error: String(e)
        }
      }
      collectedUsersData[userHref] = dataEntry;
    }
    // 進捗表示（100件ごと、または最後）
    if (i % 100 === 0 || i === allUsersArray.length - 1) {
      console.log(`    --- Progress: ${i + 1}/${allUsersArray.length} user data (${formatDuration(Date.now() - fetchStartTimestamp)})`);
    }
  }
  // 取得したuserAfflicationsのURLからafflicationの情報をfetch
  const userAfflicationsArray = Array.from(userAfflications);
  console.log(`Found ${userAfflicationsArray.length} user affiliations to fetch`);
  for (let i = 0; i < userAfflicationsArray.length; i++) {
    const affHref = userAfflicationsArray[i];
    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`[${i + 1}/${userAfflicationsArray.length}] Fetching: ${affHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(affHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      if (VERBOSE) console.log(`    ✓ user affiliation data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching user affiliation data ${affHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { error: String(e) };
    }
    collectedUsersData[affHref] = dataEntry;

    if (fetchCount % 100 === 0 || i === userAfflicationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${userAfflicationsArray.length} user affiliations (${formatDuration(duration)})`);
    }
  }
  // 取得したユーザのGroupsを取得をfetch
  const userGroupsArray = Array.from(userGroups);
  console.log(`Found ${userGroupsArray.length} users groups to fetch`);
  for (let i = 0; i < userGroupsArray.length; i++) {
    const groupHref = userGroupsArray[i];

    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`[${i + 1}/${userGroupsArray.length}] Fetching: ${groupHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(groupHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      if (VERBOSE) console.log(`    ✓ user group data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching user group group data ${groupHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { error: String(e) };
    }
    collectedUsersData[groupHref] = dataEntry;

    if (fetchCount % 100 === 0 || i === userGroupsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${userGroupsArray.length} groups (${formatDuration(duration)})`);
    }
  }

  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} users data (Errors: ${errorCount})`);
  return collectedUsersData;
}

async function fetchAffiliations(collectedParticipationsData, collectedUsersData, isTestMode) {
  console.log('start fetching Affiliations');
  // 戻り値のaffiliationsデータ格納用オブジェクトを初期化
  let collectedAffiliationsData = {};

  // 1. participationsからorganization affiliationを抽出
  const affiliationsFromParticipations = new Set();
  for (const url in collectedParticipationsData) {
    if (url.endsWith('/participants')) continue; // participantsのデータは除外
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    if (data._links && data._links.organization && data._links.organization.href) {
      affiliationsFromParticipations.add(data._links.organization.href);
    }
  }
  console.log(`Found ${affiliationsFromParticipations.size} affiliations from participations`);

  // 2. usersのaffiliationsエンドポイントから_links.affiliations配下のhrefを抽出（配列・オブジェクト両対応）
  const affiliationsFromUsers = new Set();
  for (const url in collectedUsersData) {
    if (!url.endsWith('/affiliations')) continue; // affiliationsのデータのみ対象
    const entry = collectedUsersData[url];
    // 2重構造対応: { [url]: { [url]: { data: ... } } } の場合も考慮
    let data = entry && entry.data;
    if (!data && entry && typeof entry === 'object') {
      // 2重構造: entry[url].
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
            affiliationsFromUsers.add(aff.href);
          }
        }
      } else if (typeof affiliations === 'object') {
        for (const key of Object.keys(affiliations)) {
          const aff = affiliations[key];
          if (aff && aff.href) {
            affiliationsFromUsers.add(aff.href);
          }
        }
      }
    }
  }
  console.log(`Found ${affiliationsFromUsers.size} affiliations from users`);

  const combiedAffiliations = new Set([...affiliationsFromParticipations, ...affiliationsFromUsers]);
  console.log(`Combined affiliations from participations and users: ${combiedAffiliations.size}`);

  // フェッチの開始
  let fetchCount = 0, fetchedCount = 0, errorCount = 0;
  let affiliationsArray = [];
  if (isTestMode) {
    // console.log('Running in TEST mode - fetching only affiliations found from participations and users');
    // affiliationsArray = Array.from(combiedAffiliations);
    console.log('Running in TEST mode - fetching only affiliations found from participations');  // membersとIEのみ、indivaidualのaffiliationsはfetchしない
    affiliationsArray = Array.from(affiliationsFromParticipations);
  } else {
    // 3. affiliationsリストをfetchして全affiliationsのURLを取得
    const affUrl = `https://api.w3.org/affiliations/`;
    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    let affiliationsArrayFromList = [];
    console.log(`Fetching the list of all affiliations: ${affUrl}, this may take a few minutes`);
    try {
      fetchCount++;
      const { lastModified, data } = await fetchApiData(affUrl, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;
      for (const affiliation of data._links.affiliations) {
        affiliationsArrayFromList.push(affiliation.href);
      }
      if (VERBOSE) console.log(`    ✓ the affiliation list fetched`);
      fetchedCount++;
    } catch (e) {
      if (VERBOSE) {
        console.warn(`error fetching the affiliation list ${affUrl}: ${String(e)}`);
      }
      errorCount++;

      dataEntry = { error: String(e) };
    }
    collectedAffiliationsData[affUrl] = dataEntry;

    // 4. フェッチするaffiliationsリストを決定
    console.log(`Found ${affiliationsArrayFromList.length} affiliations from the affiliation list`);
    affiliationsArray = affiliationsArrayFromList;
  }

  // 5. affiliationsをfetch
  console.log(`All affiliations to fetch: ${affiliationsArray.length}`);
  const participantsFromAffiliations = new Set();
  for (let i = 0; i < affiliationsArray.length; i++) {
    const affHref = affiliationsArray[i];
    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`[${i + 1}/${affiliationsArray.length}] Fetching affiliation: ${affHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(affHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      // affiliationのparticipantsエンドポイントをparticipantsリストに追加
      if (data._links && data._links.participants && data._links.participants.href) {
        participantsFromAffiliations.add(data._links.participants.href);
      }

      if (VERBOSE) console.log(`    ✓ affiliation data fetched`);
      fetchedCount++;
    } catch (e) {
      if (VERBOSE) {
        console.warn(`error fetching affiliation ${affHref}: ${String(e)}`);
      }
      errorCount++;

      dataEntry.data = { error: String(e) };
    }
    collectedAffiliationsData[affHref] = dataEntry

    if (i % 100 === 0 || i === affiliationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${affiliationsArray.length} affiliations (${formatDuration(duration)})`);
    }
  }

  // groupに参加していないMPをPhase4で読むためにはAfflicationsのparticipationのurlもe.g. https://api.w3.org/affiliations/1057/participants"読んでデータを保存する
  const participantsArray = Array.from(participantsFromAffiliations);
  console.log(`Found ${participantsArray.length} affiliation participants to fetch`);
  for (let i = 0; i < participantsArray.length; i++) {
    const participantsHref = participantsArray[i];

    let dataEntry = {
      fetchedAt: new Date().toUTCString(), // HTTP-date形式
      lastModified: undefined,
      data: undefined
    }
    try {
      if (VERBOSE) console.log(`[${i + 1}/${participantsArray.length}] Fetching: ${participantsHref}`);
      fetchCount++;

      const { lastModified, data } = await fetchApiData(participantsHref, VERBOSE);
      dataEntry.lastModified = lastModified;
      dataEntry.data = data;

      if (VERBOSE) console.log(`    ✓ affiliation participants data fetched`);
      fetchedCount++;
    } catch (e) {
      console.warn(`  error fetching affiliation participant data ${participantsHref}: ${String(e)}`);
      errorCount++;

      dataEntry.data = { error: String(e) };
    }
    collectedAffiliationsData[participantsHref] = dataEntry;

    if (fetchCount % 100 === 0 || i === participantsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${participantsArray.length} affiliation participants (${formatDuration(duration)})`);
    }
  }

  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} affiliations data (Errors: ${errorCount})`);
  return collectedAffiliationsData;
}

async function fetchUsersWhoAreNotInGroups(collectedAffiliationsData, collectedUsersData, isSkipFetchUsersNotInGroups) {
  console.log('Start fetching Users who are not in any Groups');
  // collectedAffiliationsDataから全参加者(users)を抽出
  const userHrefsFromAffiliations = new Set();
  for (const url in collectedAffiliationsData) {
    // urlはhttps://api.w3.org/affiliations/{hash}の形式
    if (!reAffiliations.test(url)) continue;
    // ここで https://api.w3.org/affiliations/{hash} 形式のデータだけ処理
    const entry = collectedAffiliationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    // 参加者(users)をaffiliationsのparticipantsエンドポイントから取得
    if (data._links && data._links.participants && data._links.participants.href) {
      const participantsUrl = data._links.participants.href;
      try {
        // 参加者リストをfetch
        const participantsData = collectedAffiliationsData[participantsUrl].data
        if (!participantsData) {
          console.warn(`Warning: No data found for participants in collectedAffiliationsData: ${participantsUrl}`);
          continue;
        }
        if (participantsData && participantsData._links && participantsData._links.participants) {
          const participants = participantsData._links.participants;
          if (Array.isArray(participants)) {
            for (const participant of participants) {
              if (participant && participant.href) {
                userHrefsFromAffiliations.add(participant.href);
              }
            }
          } else if (participants && typeof participants === 'object') {
            for (const participant of Object.values(participants)) {
              if (participant && participant.href) {
                userHrefsFromAffiliations.add(participant.href);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`Error fetching participants for affiliation ${url}: ${String(e)}`);
      }
    }
  }
  console.log(`Total users extracted from affiliations: ${userHrefsFromAffiliations.size}`);
  // collectedUsersDataから全ユーザーを抽出
  const userHrefsFromUsers = new Set(Object.keys(collectedUsersData).filter(href => reUsers.test(href)));
  console.log(`Users who are in any groups (i.e. already fetched users)): ${userHrefsFromUsers.size}`);
  // affiliationsから抽出したユーザーのうち、collectedUsersDataに存在しないユーザーを抽出
  const userHrefsWhoAreNotInGroups = new Set([...userHrefsFromAffiliations].filter(x => !userHrefsFromUsers.has(x)));
  console.log(`Users who are not in any groups (i.e. not yet fetched users): ${userHrefsWhoAreNotInGroups.size}`);
  let fetchUserHrefs = Array.from(userHrefsWhoAreNotInGroups);

  if (isSkipFetchUsersNotInGroups) {
    console.log('--- isSkipFetchUsersNotInGroups = true');
    return collectedUsersData
  }

  // 抽出したユーザーをfetch    
  let additionalUsersData = await fetchUsersData(fetchUserHrefs);
  const newCollectedUsersData = { ...collectedUsersData, ...additionalUsersData };
  console.log(`Total users data collected after merging users who are not in any Groups: ${newCollectedUsersData.length}`);

  return newCollectedUsersData;
}


async function phase1_fetchGroups(dirPath, groupsFilename, isTestMode) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
  // shouldFetchGroupsはmainで判定。isTestModeのみ引数で受け取る。
  logAlways('\n========== PHASE 1 (groups): Started ==========\n');
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
  logAlways(`\n========== PHASE 1 (groups): Finished ==========`);
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
  const isFinished = await compareAndWriteJson(dirPath, groupsFilename, collectedGroupsData);
  if (isFinished) {
    logAlways('✓ The latest Groups data is up to date.');
  }
  return isFinished;
}

async function phase2_fetchParticipations(dirPath, groupsFilename, participationFilename) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
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
  logAlways(`\n========== PHASE 2 (participations): Finished ==========`);
  logAlways(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[1] = phaseRequestCount;
  const isFinished = await compareAndWriteJson(dirPath, participationFilename, collectedParticipationsData);
  if (isFinished) {
    logAlways('✓ The latest Participations data is up to date.');
  }
  return isFinished;
}

// PHASE 3: Users

async function phase3_fetchUsers(dirPath, groupsFilename, participationFilename, usersFilename) {
  const groupsFilePath = dirPath + '/' + groupsFilename;
  const participationFilePath = dirPath + '/' + participationFilename;
  logAlways('\n========== PHASE 3 (users): Started ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  let collectedGroupsData = {};
  let collectedParticipationsData = {};
  let collectedAffiliationsData = {};

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
  let collectedUsersData = await fetchUsers(collectedGroupsData, collectedParticipationsData, collectedAffiliationsData);
  logAlways(`\n========== PHASE 3 (users): Finished ==========`);
  logAlways(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[2] = phaseRequestCount;
  const isFinished = await compareAndWriteJson(dirPath, usersFilename, collectedUsersData);
  if (isFinished) {
    logAlways('✓ The latest Users data is up to date.');
  }
  return isFinished;
}

// PHASE 4: Affiliations
async function phase4_fetchAffiliations(dirPath, participationFilename, usersFilename, affiliationsFilename, isTestMode) {
  const participationFilePath = dirPath + '/' + participationFilename;
  const usersFilePath = dirPath + '/' + usersFilename;
  logAlways('\n========== PHASE 4 (affiliations): Started ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();

  // participationsデータを都度ロード
  let collectedParticipationsData = {};
  try {
    const participationsContent = fs.readFileSync(participationFilePath, 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} items from ${participationFilePath}`);
  } catch (e) {
    console.error(`Error: Cannot load ${participationFilePath}: ${e.message}`);
    process.exit(1);
  }

  // usersデータを都度ロード
  let collectedUsersData = {};
  try {
    const usersContent = fs.readFileSync(usersFilePath, 'utf8');
    collectedUsersData = JSON.parse(usersContent);
    logAlways(`Loaded ${Object.keys(collectedUsersData).length} items ${usersFilePath}`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-users.json: ${e.message}`);
    process.exit(1);
  }

  const collectedAffiliationsData = await fetchAffiliations(collectedParticipationsData, collectedUsersData, isTestMode);
  logAlways(`\n========== PHASE 4 (affiliations): Finished ==========`);
  logAlways(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[3] = phaseRequestCount;
  const isFinished = await compareAndWriteJson(dirPath, affiliationsFilename, collectedAffiliationsData);
  if (isFinished) {
    logAlways('✓ The latest Affiliations data is up to date.');
  }
  return isFinished;
}

async function phase5_fetchUsersWhoAreNotInGroups(dirPath, affiliationsFilename, usersFilename, isSkipFetchUsersNotInGroups) {
  const affiliationsFilePath = dirPath + '/' + affiliationsFilename;
  const usersFilePath = dirPath + '/' + usersFilename;
  logAlways('\n========== PHASE 5 (users-not-in-groups): Started ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();

  // affiliationsデータを都度ロード
  let collectedAffiliationsData = {};
  try {
    const affiliationsContent = fs.readFileSync(affiliationsFilePath, 'utf8');
    collectedAffiliationsData = JSON.parse(affiliationsContent);
    logAlways(`Loaded ${Object.keys(collectedAffiliationsData).length} items from ${affiliationsFilePath}`);
  } catch (e) {
    console.error(`Error: Cannot load ${affiliationsFilePath}: ${e.message}`);
    process.exit(1);
  }

  // usersデータを都度ロード
  let collectedUsersData = {};
  try {
    const usersContent = fs.readFileSync(usersFilePath, 'utf8');
    collectedUsersData = JSON.parse(usersContent);
    logAlways(`Loaded ${Object.keys(collectedUsersData).length} items ${usersFilePath}`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-users.json: ${e.message}`);
    process.exit(1);
  }

  const newCollectedUsersData = await fetchUsersWhoAreNotInGroups(collectedAffiliationsData, collectedUsersData, isSkipFetchUsersNotInGroups);
  logAlways(`\n========== PHASE 5 (users-not-in-groups): Finished  ==========`);
  let isFinished = true
  if (isSkipFetchUsersNotInGroups) {
    logAlways(`Skipped fetching users who are not in any Groups since it will take a long time.`);
  } else {
    logAlways(`Total users data collected after merging users who are not in any Groups: ${newCollectedUsersData.length}`);
    const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
    logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
    logAlways(`Total requests: ${phaseRequestCount}`);
    logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
    phaseRequestCounts[4] = phaseRequestCount;
    // usersデータを再書き込み
    isFinished = await compareAndWriteJson(dirPath, usersFilename, newCollectedUsersData);
  }
  if (isFinished) {
    logAlways('✓ The latest Users data is up to date.');
  }
  return isFinished;
}

async function createDataJson(dirPath, usedFilenames, dataFileName, testGroups) {
  const files = [];
  for (const filename of usedFilenames) {
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
      console.error(`Error: reading/parsing ${path}: ${e.message}`);
      break
    }
  }
  if (files.length == usedFilenames.length) {
    // testMode時はtestGroupsリストを_metadataに追加
    const metadata = {
      filename: dataFileName,
      lastChecked: new Date().toUTCString() // HTTP-date
    };
    if (testGroups) {
      metadata.testGroups = testGroups;
    }
    const w3cData = {
      _metadata: metadata,
      files
    };
    const path = dirPath + '/' + dataFileName
    fs.writeFileSync(path, JSON.stringify(w3cData, null, 2), 'utf8');
    console.log(`✓ ${path} created successfully.`);
  } else {
    console.error(`Error: ${dataFileName} not created due to errors in the previous phases.`);
  }
}

function printUsage() {
  console.log(`\nUsage:
  node scripts/fetch-w3c-data.js                    # All Phases: Fetch all data (All Phases: groups + participations + affiliations + users)
  node scripts/fetch-w3c-data.js --groups --test    # Test mode (only sample groups)
  node scripts/fetch-w3c-data.js --groups           # Only Phase1: update groups, participations lists, users lists in w3c-groups.json
  node scripts/fetch-w3c-data.js --participations   # Only Phase2: update participation details in w3c-participations.json (requires w3c-groups.json)
   node scripts/fetch-w3c-data.js --users           # Only Phase3: update user details in w3c-users.json (requires w3c-participations.json and w3c-affiliations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Only Phase4: update affiliations in w3c-affiliations.json (requires w3c-participations.json)

  node scripts/fetch-w3c-data.js --users-not-in-groups  # Only Phase5: update users who are not in any groups  in w3c-users.json (requires w3c-participations.json and w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Only Phase1 and Phase2: update groups and participations
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
    '--groups', '--test', '--participations', '--users', '--affiliations', '--users-not-in-groups', '--phase1', '--phase2', '--phase3', '--phase4', '--phase5', '--verbose', '--help', '-h'
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
  const fetchGroups = process.argv.includes('--groups') || process.argv.includes('--phase1');
  const fetchParticipations = process.argv.includes('--participations') || process.argv.includes('--phase2');
  const fetchUsers = process.argv.includes('--users') || process.argv.includes('--phase3');
  const fetchAffiliations = process.argv.includes('--affiliations') || process.argv.includes('--phase4');
  const fetchUsersNotInGroups = process.argv.includes('--users-not-in-groups') || process.argv.includes('--phase5')
  const fetchAll = !fetchGroups && !fetchParticipations && !fetchAffiliations && !fetchUsers && !fetchUsersNotInGroups;
  const isSkipFetchUsersNotInGroups = true // 注意：groupに参加していないparticipantsの多すぎるので、--skipFetchUsersNotInGroupsをつけない限り取得しない。
  // const isSkipFetchUsersNotInGroups = false // テストはこちら。
  const fileNames = {
    data: 'w3c-data.json',
    groups: 'w3c-groups.json',
    participations: 'w3c-participations.json',
    users: 'w3c-users.json',
    affiliations: 'w3c-affiliations.json'
  };
  let usedFileSet = new Set();

  let phase1Finished = false;
  let phase2Finished = false;
  let phase3Finished = false;
  let phase4Finished = false;
  if (fetchAll || fetchGroups) {
    usedFileSet.add(fileNames.groups);
    phase1Finished = await phase1_fetchGroups(dirPath, fileNames.groups, isTestMode);
  }
  if (fetchAll || fetchParticipations) {
    usedFileSet.add(fileNames.groups);
    usedFileSet.add(fileNames.participations);
    phase2Finished = await phase2_fetchParticipations(dirPath, fileNames.groups, fileNames.participations);
  }
  if (fetchAll || fetchUsers) {
    usedFileSet.add(fileNames.groups);
    usedFileSet.add(fileNames.participations);
    usedFileSet.add(fileNames.users);
    phase3Finished = await phase3_fetchUsers(dirPath, fileNames.groups, fileNames.participations, fileNames.users);
  }

  if (fetchAll || fetchAffiliations) {
    usedFileSet.add(fileNames.participations);
    usedFileSet.add(fileNames.users);
    usedFileSet.add(fileNames.affiliations);
    phase4Finished = await phase4_fetchAffiliations(dirPath, fileNames.participations, fileNames.users, fileNames.affiliations, isTestMode);
  }

  if (fetchAll || fetchUsersNotInGroups) {
    usedFileSet.add(fileNames.participations);
    usedFileSet.add(fileNames.affiliations);
    phase3Finished = await phase5_fetchUsersWhoAreNotInGroups(dirPath, fileNames.affiliations, fileNames.users, isSkipFetchUsersNotInGroups);
  }

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== All Summary ==========`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  // トータルリクエスト数と平均
  console.log(`Total requests (all phases): ${totalRequestCount}`);
  const totalDurationSec = duration / 1000;
  console.log(`Average requests/sec (all phases): ${(totalRequestCount / totalDurationSec).toFixed(2)}`);

  // w3c-data.json生成は全Phase（groups, participations, users, affiliations）を実行した場合のみ
  if (phase1Finished && phase2Finished && phase3Finished && phase4Finished) {
    // files配列構築
    await createDataJson(dirPath, Array.from(usedFileSet), fileNames.data, isTestMode ? testGroups : null);
  } else {
    console.log('w3c-data.json not created because not all phases ran.');
  }
  console.log('All done.');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
