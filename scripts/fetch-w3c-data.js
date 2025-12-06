// 先頭でデータ用変数を宣言
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const { error } = require('console');

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
  try {
    // 既存ファイルがあれば比較
    if (fs.existsSync(mainFile)) {
      const prevContent = fs.readFileSync(mainFile, 'utf8');
      const prevJson = JSON.parse(prevContent);
      existingMetadata = prevJson._metadata || {};
      // データ部分のみ比較（_metadata除外、各エントリのfetchedAt除外）
      const stripFetchedAt = obj => {
        if (typeof obj !== 'object' || obj === null) return obj;
        const newObj = Array.isArray(obj) ? [] : {};
        for (const k in obj) {
          if (k === '_metadata') continue;
          if (obj[k] && typeof obj[k] === 'object' && obj[k] !== null) {
            // fetchedAtを除外
            const entry = { ...obj[k] };
            if ('fetchedAt' in entry) delete entry.fetchedAt;
            newObj[k] = stripFetchedAt(entry);
          } else {
            newObj[k] = obj[k];
          }
        }
        return newObj;
      };
      const prevDataStripped = stripFetchedAt(prevJson);
      const newDataStripped = stripFetchedAt(collectedData);
      // 新データをソート
      const sortObj = obj => {
        const sorted = {};
        Object.keys(obj).sort().forEach(k => { sorted[k] = obj[k]; });
        return sorted;
      };
      const prevSorted = sortObj(prevDataStripped);
      const newSorted = sortObj(newDataStripped);
      // 差分判定
      hasChanges = JSON.stringify(prevSorted) !== JSON.stringify(newSorted);
      sortedData = newSorted;
    } else {
      sortedData = {};
      Object.keys(collectedData).sort().forEach(k => { sortedData[k] = collectedData[k]; });
      hasChanges = true;
    }
  } catch (e) {
    console.error(`Failed to write ${filename}.json: ${e.message}`);
  }
  // データが変わっていない場合はファイル保存を行わない
  if (!hasChanges) {
    console.log(`✓ No changes detected: ${mainFile} not updated.`);
    return false;
  }
  const finalDataWithMetadata = {
    _metadata: {
      filename: filename,
      lastChecked: new Date(fetchStartTimestamp).toISOString(),
      fetchStartTime: fetchStartTime,
      duration: durationStr,
      itemCount: Object.keys(sortedData).length
    },
    ...sortedData
  };
  const finalContent = JSON.stringify(finalDataWithMetadata, null, 2);
  fs.writeFileSync(mainFile, finalContent, 'utf8');
  console.log(`✓ Main file updated with data changes: ${mainFile}`);
  return true;
}

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

          // [RESPONSE] ログ出力（status, content-length, mime-type）
          if (VERBOSE && !process.env.SUPPRESS_REQUEST_LOG) {
            const status = res.statusCode;
            const clen = res.headers['content-length'] || raw.length;
            const mime = res.headers['content-type'] || '';
            console.log(`    [RESPONSE] status=${status} content-length=${clen} mime-type=${mime}`);
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
  let lastError = undefined;
  // すべてのページを取得
  while (url) {
    let fetchStart = Date.now();
    let fetchEnd;
    try {
      const r = await fetchJson(url, 6, 5000, 120000);
      fetchEnd = Date.now();
      pages.push(r);
      url = r?._links?.next?.href || null;
    } catch (e) {
      fetchEnd = Date.now();
      let errorMsg = '';
      if (typeof e === 'object' && e !== null) {
        if (e.statusCode && e.url) {
          errorMsg = `Error: ${e.statusCode} ${e.url}`;
        } else if (e.message && e.url) {
          errorMsg = `Error: ${e.message} ${e.url}`;
        } else if (e.message) {
          errorMsg = `Error: ${e.message}`;
        } else if (e.statusCode) {
          errorMsg = `Error: ${e.statusCode}`;
        } else {
          errorMsg = JSON.stringify(e);
        }
      } else {
        errorMsg = `${String(e)}`;
      }
      if (errorMsg.startsWith('{')) {
        errorMsg = '[object Object]';
      }
      console.warn(`[ERROR] ${errorMsg}`);
      lastError = errorMsg;
      url = null; // break
    }
    const elapsed = fetchEnd - fetchStart;
    const sleepMs = REQUEST_INTERVAL - elapsed;
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
    if (VERBOSE) {
      console.log(`    [INFO] elapsed ${elapsed}ms  sleep ${sleepMs}ms`);
    }
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
  let collectedTypeGroupsData = {};
  const typeUrl = `https://api.w3.org/groups/${type}`;
  // typeUrl: 'https://api.w3.org/groups/wg' など
  // collectedGroupsData: {} or 既存データ
  const typeName = type.toUpperCase();
  // 通常ログのみで出力（重複防止）
  logAlways(`\n========== Fetching groups: ${typeName} ==========`);
  logAlways(`Fetching ${typeName} list pages...`);
  let groups = [];
  let data = {};
  try {
    data = await fetchData(typeUrl);
    // Extract groups from the merged result
    groups = data?._links?.groups || [];
    if (VERBOSE) console.log(`Found ${groups.length} ${typeName} groups\n`);
    // テストモードの場合、shortnameでフィルタリング
    if (testGroupShortNames && Array.isArray(testGroupShortNames)) {
      groups = groups.filter(g => {
        const href = g.href || '';
        return testGroupShortNames.some(shortname => href.includes(`/${typeName.toLowerCase()}/${shortname}`));
      });
      console.log(`Filtered for testShortNames: ${testGroupShortNames.join(', ')} → ${groups.length} groups`);
    }
  } catch (e) {
    data = {
      "_error": String(e)
    }
    console.error(`Failed to fetch ${typeName} list: ${e.message}`);
  }
  collectedTypeGroupsData[typeUrl] = {
    fetchedAt: new Date().toISOString(),
    data: data
  };

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const groupName = g.title || g.name || g.id || 'unknown';
    logAlways(`[${i + 1}/${groups.length}] Processing: ${groupName}`);
    const groupHref = g.href;
    let urls = [];
    if (groupHref) {
      let groupData = {};
      // Fetch group details
      try {
        if (VERBOSE) console.log(`  → Fetching group data from ${groupHref}`);
        groupData = await fetchData(groupHref);

        const partHref = groupData._links?.participations?.href;
        if (partHref) {
          urls.push(partHref);
        }
        const usersHref = groupData._links?.users?.href;
        if (usersHref) {
          urls.push(usersHref);
        }
      } catch (e) {
        data = { "_error": String(e) };
      }
      collectedTypeGroupsData[groupHref] = {
        fetchedAt: new Date().toISOString(),
        data: groupData
      }
    }

    let fetchCount = 0;
    let errorCount = 0;
    let fetchedCount = 0;

    // Fetch the urls for the group
    console.log(`  Found ${urls.length} data URLs to fetch for group`);
    for (let j = 0; j < urls.length; j++) {
      fetchCount++;
      const url = urls[j];
      let data = {}
      try {
        data = await fetchData(url)
        fetchedCount++;
      } catch (e) {
        data = { "_error": String(e) };
        errorCount++;
      }
      collectedTypeGroupsData[url] = {
        fetchedAt: new Date().toISOString(),
        data: data
      }
    }
    // 100件ごとにProgress
    if (fetchCount % 100 === 0 || i === groups.length - 1 ) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`--- Progress: ${fetchCount} fetches (${formatDuration(duration)})`);
    }
  }
  return collectedTypeGroupsData;
}

async function fetchParticipations(collectedGroupsData, collectedParticipationsData) {
  console.log('\n========== Fetching Participations ==========');
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
  const allParticipations = Array.from(allParticipationsSet);
  const participants = []
  console.log(`Found ${allParticipations.length} unique participation data to fetch\n`);
  let fetchedCount = 0;
  let errorCount = 0;
  let fetchCount = 0;
  for (let i = 0; i < allParticipations.length; i++) {
    const partHref = allParticipations[i];
    let detailEntry = undefined;
    fetchCount++;
    if (VERBOSE) console.log(`[${fetchCount}] Fetching: ${partHref}`);
    // 1. リストページ（/groups/.../participations）をfetch
    const detailData = await fetchData(partHref);
    collectedParticipationsData[partHref] = {
      fetchedAt: new Date().toISOString(),
      data: detailData !== undefined ? detailData : { _error: 'Failed to fetch participations detail' }
    };
    // 2. その中の _links.participations から個別participationのhrefを抽出
    const participationsObj = detailEntry.data && detailEntry.data._links && detailEntry.data._links.participations;
    if (participationsObj && typeof participationsObj === 'object') {
      for (const key in participationsObj) {
        const p = participationsObj[key];
        if (p && p.href && /^https:\/\/api\.w3\.org\/participations\/.+/.test(p.href)) {
          try {
            fetchCount++;
            const participationDetailData = await fetchData(p.href);
            collectedParticipationsData[p.href] = {
              fetchedAt: new Date().toISOString(),
              data: participationDetailData !== undefined ? participationDetailData : { _error: 'Failed to fetch participation detail' }
            };
            const detailData = participationDetailData;
            if (detailData && detailData.individual === false && detailData._links?.participants?.href) {
              participants.push(detailData._links.participants.href);
            }
          } catch (e) {
            collectedParticipationsData[p.href] = {
              fetchedAt: new Date().toISOString(),
              data: { error: String(e) }
            };
            console.warn(`    error fetching participation detail ${p.href}: ${String(e)}`);
            errorCount++;
          }
          // 進捗表示（100件ごと, 最後の1件）
          if (fetchCount % 100 === 0) {
            const duration = Date.now() - fetchStartTimestamp;
            console.log(`\n--- Progress: ${fetchCount} fetches (${formatDuration(duration)}) ---\n`);
          }
        }
      }
    }
  }
  // Fetch participants for organization participations (individual=false)
  console.log(`Found ${participants.length} unique participants data to fetch\n`);
  for (const participantsHref of participants) {
    try {
      fetchCount++;
      const participantsData = await fetchData(participantsHref);
      collectedParticipationsData[participantsHref] = {
        fetchedAt: new Date().toISOString(),
        data: participantsData !== undefined ? participantsData : { _error: 'failed to fetch participants data' }
      };
      console.log(`    ✓ Participants data fetched`);
      fetchedCount++;
    } catch (e) {
      collectedParticipationsData[participantsHref] = {
        fetchedAt: new Date().toISOString(),
        data: { error: String(e) }
      };
      console.warn(`  error fetching participant data ${participantsHref}: ${String(e)}`);
      errorCount++;
    }
    // 進捗表示（100件ごと, 最後の1件）
    if (fetchCount % 100 === 0) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`\n--- Progress: ${fetchCount} fetches (${formatDuration(duration)}) ---\n`);
    }
  }
  console.log(`\n✓ Completed: Fetched ${fetchedCount}/${allParticipations.length} participations data (Errors: ${errorCount})`);
  return collectedParticipationsData;
}

async function fetchUsers(collectedGroupsData, collectedParticipationsData) {
  console.log('\n========== Fetching Users ==========');
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
  const userAfflications = [];
  const userGroups = [];
  let fetchCount = 0, fetchedCount = 0, errorCount = 0;
  console.log(`Found ${allUsersArray.length} users to fetch\n`);
  for (let i = 0; i < allUsersArray.length; i++) {
    const userHref = allUsersArray[i];
    let hasError = false;
    if (userHref) {
      try {
        if (VERBOSE) {
          console.log(`[${i + 1}/${allUsersArray.length}] Fetching: ${userHref}`);
        }
        // 全Phaseで[REQUEST][RESPONSE]を出す（SUPPRESS_REQUEST_LOGは使わない）
        const userData = await fetchData(userHref);
        collectedUsersData[userHref] = {
          fetchedAt: new Date().toISOString(),
          data: userData !== undefined ? userData : { _error: 'Failed to fetch user detail' }
        };
        if (userData && userData._links && userData._links.affiliations) {
          // affiliationsが配列の場合
          if (Array.isArray(userData._links.affiliations)) {
            for (const aff of userData._links.affiliations) {
              if (aff && aff.href) {
                userAfflications.push(aff.href);
                // affiliationsエンドポイントもfetchして保存
                try {
                  const affListData = await fetchData(aff.href);
                  collectedUsersData[aff.href] = {
                    fetchedAt: new Date().toISOString(),
                    data: affListData !== undefined ? affListData : { _error: 'Failed to fetch user affiliations' }
                  };
                } catch (e) {
                  collectedUsersData[aff.href] = {
                    fetchedAt: new Date().toISOString(),
                    data: { error: String(e) }
                  };
                }
              }
            }
          } else if (typeof userData._links.affiliations === 'object' && userData._links.affiliations.href) {
            userAfflications.push(userData._links.affiliations.href);
            // affiliationsエンドポイントもfetchして保存
            try {
              const affListData = await fetchData(userData._links.affiliations.href);
              collectedUsersData[userData._links.affiliations.href] = {
                fetchedAt: new Date().toISOString(),
                data: affListData !== undefined ? affListData : { _error: 'Failed to fetch user affiliations' }
              };
            } catch (e) {
              collectedUsersData[userData._links.affiliations.href] = {
                fetchedAt: new Date().toISOString(),
                data: { error: String(e) }
              };
            }
          }
        }
        if (userData && userData._links && userData._links.groups) {
          if (Array.isArray(userData._links.groups)) {
            for (const grp of userData._links.groups) {
              if (grp && grp.href) {
                userGroups.push(grp.href);
              }
            }
          } else if (typeof userData._links.groups === 'object' && userData._links.groups.href) {
            userGroups.push(userData._links.groups.href);
          }
        }
        if (VERBOSE) {
          console.log(`    ✓ Fetched user data`);
        }
      } catch (e) {
        collectedUsersData[userHref] = {
          fetchedAt: new Date().toISOString(),
          data: { error: String(e && e.message ? e.message : e) }
        };
        hasError = true;
      }
    }
    if (!hasError) {
      fetchedCount++;
    } else {
      if (VERBOSE) {
        console.warn(`error fetching user data ${userHref}`);
      }
      errorCount++;
    }
    // 進捗表示（100件ごと、または最後）
    if (i % 100 === 0 || i === allUsersArray.length - 1) {
      console.log(`--- Progress: ${i + 1}/${allUsersArray.length} user data (${formatDuration(Date.now() - fetchStartTimestamp)})`);
    }
  }
  console.log(`Found ${userAfflications.length} users affiliations to fetch\n`);
  for (let i = 0; i < userAfflications.length; i++) {
    const affHref = userAfflications[i];
    try {
      fetchCount++;
      const affData = await fetchData(affHref);
      collectedUsersData[affHref] = {
        fetchedAt: new Date().toISOString(),
        data: affData !== undefined ? affData : { _error: 'Failed to fetch user affiliations' }
      };
      console.log(`    ✓ Affiliation data fetched`);
      fetchedCount++;
    } catch (e) {
      collectedUsersData[affHref] = {
        fetchedAt: new Date().toISOString(),
        data: { error: String(e) }
      };
      console.warn(`  error fetching affiliation data ${affHref}: ${String(e)}`);
      errorCount++;
    }
    if (fetchCount % 100 === 0 || i === userAfflications.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`--- Progress: ${i + 1}/${userAfflications.length} affiliations (${formatDuration(duration)})`);
    }
  }

  console.log(`Found ${userGroups.length} user groups to fetch\n`);
  for (let i = 0; i < userGroups.length; i++) {
    const groupHref = userGroups[i];
    try {
      fetchCount++;
      const groupData = await fetchData(groupHref);
      collectedUsersData[groupHref] = {
        fetchedAt: new Date().toISOString(),
        data: groupData !== undefined ? groupData : { _error: 'Failed to fetch user group' }
      };
      console.log(`    ✓ Group data fetched`);
      fetchedCount++;
    } catch (e) {
      collectedUsersData[groupHref] = {
        fetchedAt: new Date().toISOString(),
        data: { error: String(e) }
      };
      console.warn(`  error fetching group data ${groupHref}: ${String(e)}`);
      errorCount++;
    }
    if (fetchCount % 100 === 0 || i === userGroups.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`--- Progress: ${i + 1}/${userGroups.length} groups (${formatDuration(duration)})`);
    }
  }

  console.log(`\n✓ Completed: Fetched ${fetchedCount}/${fetchCount} users data (Errors: ${errorCount})`);
  return collectedUsersData;
}

async function fetchAffiliations(collectedParticipationsData, collectedUsersData) {
  console.log('\n========== Fetching Affiliations ==========');
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
  const allAffiliationsArray = Array.from(allAffiliations);
  console.log(`Found ${allAffiliationsArray.length} affiliations to fetch\n`);
  let fetchedAffiliations = 0;
  let errorCount = 0;
  for (let i = 0; i < allAffiliationsArray.length; i++) {
    const affHref = allAffiliationsArray[i];
    try {
      if (VERBOSE) console.log(`[${i + 1}/${allAffiliationsArray.length}] Fetching affiliation: ${affHref}`);
      const affData = await fetchData(affHref);
      collectedAffiliationsData[affHref] = {
        fetchedAt: new Date().toISOString(),
        data: affData !== undefined ? affData : { _error: 'Failed to fetch affiliation detail' }
      };
      fetchedAffiliations++;
    } catch (e) {
      collectedAffiliationsData[affHref] = {
        fetchedAt: new Date().toISOString(),
        data: { error: String(e) }
      };
      if (VERBOSE) {
        console.warn(`error fetching affiliation ${affHref}: ${String(e)}`);
      }
      errorCount++;
    }
    if (i % 100 === 0 || i === allAffiliationsArray.length - 1) {
      const duration = Date.now() - fetchStartTimestamp;
      console.log(`--- Progress: ${i + 1}/${allAffiliationsArray.length} affiliations (${formatDuration(duration)})`);
    }
  }
  console.log(`\n✓ Completed: Fetched ${fetchedAffiliations}/${allAffiliationsArray.length} affiliations data (Errors: ${errorCount})`);
  return collectedAffiliationsData;
}


async function phase1_fetchGroupsParticipationsUsers({ isTestMode }) {
  // shouldFetchGroupsはmainで判定。isTestModeのみ引数で受け取る。
  logAlways('\n========== PHASE 1: Fetching Groups, Participations List, and Users list ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
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
    logAlways(`Running in TEST mode - fetching ${testGroups.length} sample groups\n`);
  }
  // groupをフェッチ
  const groupTypes = ['wg', 'ig', 'cg', 'tf', 'other'];
  for (let i = 0; i < groupTypes.length; i++) {
    const type = groupTypes[i];
    const testGroupShortNames = testGroupsShortNamesMap[type]; // テストモード時のみshortname配列を渡す
    // logAlwaysはfetchTypeGroups側で出力するため、ここでは出さない
    const typeGroupsData = await fetchTypeGroups(type, testGroupShortNames);
    Object.assign(collectedGroupsData, typeGroupsData);
    // ...existing code...
  }
  logAlways(`\n========== PHASE 1 Complete ==========`);
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
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[0] = phaseRequestCount;
  const phase1Written = await compareAndWriteJson('w3c-groups', collectedGroupsData);
  if (phase1Written) {
    logAlways('✓ Groups data successfully saved');
  }
}

async function phase2_fetchParticipations() {
  logAlways('\n========== PHASE 2: Fetching Participations ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  // groupsデータを都度ロード
  let collectedGroupsData = {};
  try {
    const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
    process.exit(1);
  }
  // participationデータは空で開始
  let collectedParticipationsData = await fetchParticipations(collectedGroupsData, {});
  logAlways(`\n========== PHASE 2 Complete ==========`);
  logAlways(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Phase duration (sec): ${phaseDurationSec.toFixed(2)}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[1] = phaseRequestCount;
  const phase2Written = await compareAndWriteJson('w3c-participations', collectedParticipationsData);
  if (phase2Written) {
    logAlways('✓ Participations data successfully saved');
  }
}

async function phase3_fetchUsers() {
  logAlways('\n========== PHASE 3: Fetching Users ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();
  let collectedGroupsData = {};
  let collectedParticipationsData = {};

  // groupsデータロード
  try {
    const groupsContent = fs.readFileSync('data/w3c-groups.json', 'utf8');
    collectedGroupsData = JSON.parse(groupsContent);
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} items from w3c-groups.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
    process.exit(1);
  }

  // participationsデータを都度ロード
  try {
    const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
    process.exit(1);
  }

  // usersデータは空で開始
  let collectedUsersData = await fetchUsers(collectedGroupsData, collectedParticipationsData);
  logAlways(`\n========== PHASE 3 Complete ===========`);
  logAlways(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[2] = phaseRequestCount;
  const phase3Written = await compareAndWriteJson('w3c-users', collectedUsersData);
  if (phase3Written) {
    logAlways('✓ Users data successfully saved');
  }
}

// （重複・壊れた定義を削除）
// PHASE 4: Affiliations
async function phase4_fetchAffiliations() {
  logAlways('\n========== PHASE 4: Fetching Affiliations ==========\n');
  phaseRequestCount = 0;
  phaseStartTimestamp = Date.now();

  // participationsデータを都度ロード
  let collectedParticipationsData = {};
  try {
    const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
    collectedParticipationsData = JSON.parse(participationsContent);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} items from w3c-participations.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-participations.json: ${e.message}`);
    process.exit(1);
  }
  // usersデータを都度ロード
  let collectedUsersData = {};
  try {
    const usersContent = fs.readFileSync('data/w3c-users.json', 'utf8');
    collectedUsersData = JSON.parse(usersContent);
    logAlways(`Loaded ${Object.keys(collectedUsersData).length} items from w3c-users.json\n`);
  } catch (e) {
    console.error(`Error: Cannot load w3c-users.json: ${e.message}`);
    process.exit(1);
  }
  const collectedAffiliationsData = await fetchAffiliations(collectedParticipationsData, collectedUsersData);
  logAlways(`\n========== PHASE 4 Complete ==========`);
  logAlways(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
  const phaseDurationSec = (Date.now() - phaseStartTimestamp) / 1000;
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / phaseDurationSec).toFixed(2)}`);
  phaseRequestCounts[3] = phaseRequestCount;
  const phase4Written = await compareAndWriteJson('w3c-affiliations', collectedAffiliationsData);
  if (phase4Written) {
    logAlways('✓ Affiliations data successfully saved');
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
  // 未対応の--option
  const unknownOptions = process.argv.slice(2).filter(opt => opt.startsWith('--') && !allowedOptions.includes(opt));
  // 未対応の-（シングルハイフン）オプション（-h以外）
  const unknownSingleOptions = process.argv.slice(2).filter(opt => opt.startsWith('-') && !opt.startsWith('--') && opt !== '-h');
  if (unknownOptions.length > 0 || unknownSingleOptions.length > 0) {
    const allUnknown = [...unknownOptions, ...unknownSingleOptions];
    console.error(`Error: Unsupported option(s): ${allUnknown.join(', ')}`);
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
  // --groups --test の場合は phase1 のみ実行
  const isTestMode = process.argv.includes('--test');
  const fetchGroups = process.argv.includes('--groups');
  const fetchParticipations = process.argv.includes('--participations');
  const fetchUsers = process.argv.includes('--users');
  const fetchAffiliations = process.argv.includes('--affiliations');
  const fetchAll = !fetchGroups && !fetchParticipations && !fetchUsers && !fetchAffiliations && !isTestMode;

  if (isTestMode && fetchGroups && !fetchParticipations && !fetchUsers && !fetchAffiliations) {
    // --groups --test の場合は phase1 のみ
    await phase1_fetchGroupsParticipationsUsers({ isTestMode });
  } else {
    if (fetchAll || isTestMode || fetchGroups) {
      await phase1_fetchGroupsParticipationsUsers({ isTestMode });
    }
    if (fetchAll || isTestMode || fetchParticipations) {
      await phase2_fetchParticipations({ isTestMode });
    }
    if (fetchAll || isTestMode || fetchUsers) {
      await phase3_fetchUsers();
    }
    if (fetchAll || isTestMode || fetchAffiliations) {
      await phase4_fetchAffiliations();
    }
  }

  const duration = Date.now() - fetchStartTimestamp;
  console.log(`\n========== All Done ==========`);
  console.log(`Total duration: ${formatDuration(duration)}`);
  // トータルリクエスト数と平均
  console.log(`Total requests (all phases): ${totalRequestCount}`);
  const totalDurationSec = duration / 1000;
  console.log(`Average requests/sec (all phases): ${(totalRequestCount / totalDurationSec).toFixed(2)}`);
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
      console.log(`Tested Groups (Test Mode) : ${testedGroupsCount}`);
    } else {
      console.log(`Total Groups: ${totalGroupsCount}`);
    }
    console.log(`Groups data: ${Object.keys(groupsData).length} items`);
  } catch { }
  try {
    const participationsContent = fs.readFileSync('data/w3c-participations.json', 'utf8');
    const participationsData = JSON.parse(participationsContent);
    console.log(`Participations data: ${Object.keys(participationsData).length} items`);
  } catch { }
  try {
    const usersContent = fs.readFileSync('data/w3c-users.json', 'utf8');
    const usersData = JSON.parse(usersContent);
    console.log(`Users data: ${Object.keys(usersData).length} items`);
  } catch { }
  try {
    const affiliationsContent = fs.readFileSync('data/w3c-affiliations.json', 'utf8');
    const affiliationsData = JSON.parse(affiliationsContent);
    console.log(`Affiliations data: ${Object.keys(affiliationsData).length} items`);
  } catch { }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
