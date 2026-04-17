// w3c-fetch-w3c-data.js

import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';;
import path from 'node:path';
import { makeStats, makeTimelineEventData, checkTimelineData } from '../w3c-stats.js';

const forceTestMode = false;   // 本番はこっち
const forceVerbose = false; // 本番はこちら
const forceRemakeTimelineJsonFile = false //本番はこちら
// const forceTestMode = true;   // テスト
// const forceVerbose = true;  // テスト
//const forceRemakeTimelineJsonFile = true;    // テスト　for debug, remake the timeline json using data-snapshots files under the 'data-snapshots" directry.
const isSkipFetchUsersNotInGroups = true // 注意：groupに参加していないparticipantsの多すぎるので、--skipFetchUsersNotInGroupsをつけない限り取得しない。 testModeではparticipationsをgroups参加者に制限するのでUsersもGroups参加者だけになる。githubではtestモードのファイルはcommitもreleaseされないので注意。

const VERBOSE = process.argv.includes('--verbose') || forceVerbose;
const REMAKE_TIMELINE = process.argv.includes('--remakeTimeline') || forceRemakeTimelineJsonFile;

function logAlways(msg) { console.log(msg); }
function logVerbose(msg) { if (VERBOSE) console.log(msg); }

// グローバル変数廃止。各Phase関数で都度ファイルロード・ローカル変数化。
let phaseStartTimestamp = 0; // 取得開始時刻（タイムスタンプ）スクリプトの開始、Phaseで変わらない
let phaseRequestCount = 0; // 各PhaseのfetchJson呼び出し回数
let totalRequestCount = 0; // 全体のfetchJson呼び出し回数
let phaseRequestCounts = []; // 各Phaseごとのリクエスト数

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes -> 10 request/sec -> 100ms
// 200ms間隔 = 5 requests/sec, 300 requests/min = 3000, requests/10min (制限の50%使用)
// 125ms間隔 = 8 requests/sec, 480 requests/min = 4800, requests/10min (制限の80%使用)
const REQUEST_INTERVAL = 200;
let lastRequestTimestamp = 0;   // 最後にRequestした時間

// typeごとにshortname配列をまとめる
const testGroupsListMid = [
  { type: 'wg', shortname: 'css' },
  { type: 'wg', shortname: 'data-shapes' },
  { type: 'ig', shortname: 'i18n' },
  { type: 'ig', shortname: 'me' },
  { type: 'ig', shortname: 'wai' },
  { type: 'cg', shortname: 'ixml' },
  { type: 'cg', shortname: 'global-inclusion' },
  { type: 'tf', shortname: 'ab-elected' },
];

const testGroupsListTiny = [  // minimal set for quick tests
  { type: 'wg', shortname: 'data-shapes' },
  { type: 'ig', shortname: 'wai' },
  { type: 'cg', shortname: 'ixml' },
  { type: 'tf', shortname: 'ab-elected' },
  { type: 'other', shortname: 'ab' },
]
const testGroupsList = testGroupsListTiny;

const reGroupsParticipations = /^https:\/\/api\.w3\.org\/groups\/[^\/]+\/[^\/]+\/participations$/;
const reGroupsUsers = /^https:\/\/api\.w3\.org\/groups\/[^\/]+\/[^\/]+\/users$/;
const reGroupSpecifications = /^https:\/\/api\.w3\.org\/groups\/[^\/]+\/[^\/]+\/specifications$/;
const reParticipationsParticipants = /^https:\/\/api\.w3\.org\/participations\/[^\/]+\/participants$/;
const reUsersAffiliations = /^https:\/\/api\.w3\.org\/users\/[^\/]+\/affiliations$/;
const reUsersGroups = /^https:\/\/api\.w3\.org\/users\/[^\/]+\/groups$/;
const reUsers = /^https:\/\/api\.w3\.org\/users\/[^\/]+$/;
const reAffiliations = /^https:\/\/api\.w3\.org\/affiliations\/[^\/]+$/;
const reSpecificationsSpec = /^https:\/\/api\.w3\.org\/specifications\/[^\/]+$/;;
const reSpecificationsSeries = /^https:\/\/api\.w3\.org\/specification-series\/[^\/]+$/;
const reSpecificationSeriesSpecs = /^https:\/\/api\.w3\.org\/specification-series\/[^\/]+\/specifications$/;
const reSpecificationsVersionHistory = /^https:\/\/api\.w3\.org\/specifications\/[^\/]+\/versions$/;
const reSpecificationsSuperseded = /^https:\/\/api\.w3\.org\/specifications\/[^\/]+\/superseded$/;
const reSpecificationsSupersedes = /^https:\/\/api\.w3\.org\/specifications\/[^\/]+\/supersedes$/;
const reSpecificationsVersion = /^https:\/\/api\.w3\.org\/specifications\/[^\/]+\/versions\/[^\/]+$/;

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


function splitFilename(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return { body: filename, ext: '' };
  }
  return {
    body: filename.slice(0, lastDot),
    ext: filename.slice(lastDot + 1)
  };
}

function makeFilename(filename, isLatest, isTestMode = false) {
  const { body, ext } = splitFilename(filename);
  const latest = isLatest ? "-latest" : "";
  const test = isTestMode ? "-test" : "";

  return body + test + latest + "." + ext;
}

function readJsonFile(dirPath, filename) {
  const filePath = `${dirPath}/${filename}`;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Invalid JSON: ${filename}`, { cause: e });
  }
}
function removeJsonFile(dirPath, filename) {
  fs.unlinkSync(`${dirPath}/${filename}`);
}
function createJsonFile(fileType, dirPath, filename, collectedData, createTime, phaseStartTime, phaseDuration, testGroups = undefined) {
  try {
    const finalDataWithMetadata = {
      _metadata: {
        fileType,
        filename: filename,
        lastChecked: createTime, // HTTP-date, currentTime
        startTime: phaseStartTime, // HTTP-date
        duration: phaseDuration,
        entryCount: Object.keys(collectedData).length, // except _metadata
        testGroups
      },
      ...collectedData
    };

    const finalContent = JSON.stringify(finalDataWithMetadata, null, 2);
    const filePath = `${dirPath}/${filename}`;
    fs.writeFileSync(filePath, finalContent, 'utf8');
    console.log(`✓ ${filePath} is created.`);
  } catch (e) {
    throw e;
  }
  return true;
}

function compareWithLatestAndWriteJsonFile(fileType, dirPath, filename, collectedData, isTestMode) {
  const metadata = collectedData._metadata;
  const testGroups = metadata.testGroups;
  const phaseStartTime = metadata.startTime;
  const phaseDuration = metadata.duration;
  let mergedData = {};
  let isNotFound = false;
  let changedCount = 0;
  const isTimeline = fileType == "timeline";

  const currFilename = makeFilename(filename, false, isTestMode);  // isLatest=false
  try {
    // 既存ファイルがあれば比較
    const currData = readJsonFile(dirPath, currFilename);
    isNotFound = currData == undefined;
    // the other json files
    if (isNotFound) {
      // 既存ファイルなければ、新しいデータをそのまま記録
      delete collectedData._metadata; // メタデータは新規につけるのでいらない
      // sortする
      Object.keys(collectedData).sort().forEach(k => { mergedData[k] = collectedData[k]; });
    } else {
      delete currData._metadata; // metadataは保続比較しない
      // キーごとに比較し、dataが同じなら古いfetchedAtを引き継ぐ
      const newData = { ...collectedData };  // copy
      delete newData._metadata; // metadataは除く、比較しない
      const allKeys = Array.from(new Set([...Object.keys(currData), ...Object.keys(newData)]));
      for (const k of allKeys.sort()) {
        const currEntry = currData[k];
        const newEntry = newData[k];
        // どちらも存在する場合のみdata比較
        if (currEntry && newEntry && currEntry.data && newEntry.data) {
          const stripFetchedAt = (entry) => {
            const { fetchedAt, ...rest } = entry;
            return rest;
          };
          // 比較ではfetchedAtは除く
          const currDataStripped = JSON.stringify(stripFetchedAt(currEntry));
          const newDataStripped = JSON.stringify(stripFetchedAt(newEntry));
          if (currDataStripped === newDataStripped) {
            // dataが同じなら古いEntryを使う
            mergedData[k] = currEntry;
          } else {
            // dataが違う場合は新しいEntryを使う
            mergedData[k] = newEntry;
            changedCount++;
          }
        } else if (newEntry) {
          // 新規追加（新しい方にはあるが古い方にはない
          mergedData[k] = newEntry;
          changedCount++;
        } else {
          // 古い方にはあるが、新しい方にはない
          if (isTimeline) {　// timelineでは古いものを新しい方に追加
            mergedData[k] = currEntry;
          } // timelineでなければ削除（）ー＞mergedDataに入れない
          changedCount++;
        }
      }
    }
  } catch (e) {
    throw e;
  }

  if (isTimeline) {
    // The timeline json file
    if (isNotFound) {
      console.log(`✓  Not found, create ${currFilename}.`);
    } else {
      console.log(`✓  Append new Timeline Event to ${currFilename}.`);
    }
  } else {
    // Fetched data json files.
    if (isNotFound) {
      console.log(`✓  Not found, create ${currFilename}.`);
    } else {
      if (changedCount == 0) {
        console.log(`✓  no entry changed, no update ${currFilename}.`);
        return 0;
      }
      console.log(`✓ ${changedCount} entries changed, update ${currFilename}.`);
    }
  }
  const createTime = new Date(Date.now()).toUTCString();
  createJsonFile(fileType, dirPath, currFilename, mergedData, createTime, phaseStartTime, phaseDuration, testGroups); // throw error
  return changedCount;
}

function fetchJson(url, retries = 6, backoffMs = 60000, timeoutMs = 180000, redirects = 5, verbose = false) {
  phaseRequestCount++;
  totalRequestCount++;

  return new Promise(async (resolve, reject) => {
    try {
      const target = new URL(url);
      const lib = target.protocol === 'http:' ? http : https;
      const headers = {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip,deflate',
        'Connection': 'close',
        'User-Agent': 'curl/8.0.1'
      };

      // adjust interval not to less than REQUEST_INTERVAL
      let requestTimestamp = Date.now();
      let requestInterval = requestTimestamp - lastRequestTimestamp;
      const sleepMs = REQUEST_INTERVAL - requestInterval;
      if (sleepMs > 0) {
        await sleep(sleepMs);
        requestTimestamp = Date.now()
        requestInterval = requestTimestamp - lastRequestTimestamp;
        if (verbose) { console.log(`    [INFO] interval ${requestInterval}ms sleep ${sleepMs}ms`); }
      } else {
        if (verbose) { console.log(`    [INFO] interval ${requestInterval}ms over ${-sleepMs} ms`); }
      }
      lastRequestTimestamp = requestTimestamp


      if (verbose) console.log(`    [REQUEST] ${url}`);
      const req = lib.get(url, { headers, timeout: timeoutMs }, res => {
        const responseTime = Date.now() - requestTimestamp

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
            console.log(`    [RESPONSE] responseTime=${responseTime}ms status=${status} content-length=${clen} last-modified=${lastModified}`);
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
              const msg = `[RETRY] responseTime=${responseTime}ms status=${res.statusCode} retry:(${retryNum}/6) wait ${backoffMs}ms`;
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
    }
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

  return ret;
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
        const specsHref = data._links?.specifications?.href;
        if (specsHref) {  // // https://api.w3.org/groups/{type}/{shortname}/specifications
          if (!reGroupSpecifications.test(specsHref)) {
            console.warn(`Warning: Unexpected groups specifications URL format: ${specsHref}`);
          }
          urls.add(specsHref);
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
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${groupsArray.length} fetches (${formatDuration(duration)})`);
    }
  }
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} groups data (Errors: ${errorCount}) CollectedTypeGroupsData entries:`, Object.keys(collectedTypeGroupsData).length);
  return collectedTypeGroupsData;
}

async function fetchParticipations(collectedGroupsData) {
  const collectedParticipationsData = {}

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
      const duration = Date.now() - phaseStartTimestamp;
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
      const duration = Date.now() - phaseStartTimestamp;
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
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${participantsArray.length} fetches (${formatDuration(duration)}) ---`);
    }
  }
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} participations data (Errors: ${errorCount}) CollectedParticipationsData entries:`, Object.keys(collectedParticipationsData).length);
  return collectedParticipationsData;
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
      console.log(`    --- Progress: ${i + 1}/${allUsersArray.length} user data (${formatDuration(Date.now() - phaseStartTimestamp)})`);
    }
  }
  // 取得したuserAfflicationsのURLからafflicationの情報をfetch
  const userAfflicationsArray = Array.from(userAfflications);
  console.log(`Found ${userAfflicationsArray.length} users extracted from affiliations`);
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
      const duration = Date.now() - phaseStartTimestamp;
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
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${userGroupsArray.length} groups (${formatDuration(duration)})`);
    }
  }

  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} users data (Errors: ${errorCount}) CollectedUsersData entries:`, Object.keys(collectedUsersData).length);
  return collectedUsersData;
}

async function fetchAffiliations(collectedParticipationsData = undefined) {
  console.log('start fetching Affiliations');
  // 戻り値のaffiliationsデータ格納用オブジェクトを初期化
  let collectedAffiliationsData = {};
  let fetchCount = 0, fetchedCount = 0, errorCount = 0;

  // affiliationsリストをfetchして全affiliationsのURLを取得
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

    dataEntry.data = { error: String(e) };
  }
  collectedAffiliationsData[affUrl] = dataEntry;

  // 4. フェッチするaffiliationsリストを決定
  console.log(`Found ${affiliationsArrayFromList.length} affiliations from the affiliation list`);
  let affiliationsArray = affiliationsArrayFromList;

  if (collectedParticipationsData) {
    // participationsからorganization affiliationを抽出,  users(indivisuals)のaffilicationはTestModeでは取得されないので注意。
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
    affiliationsArray = Array.from(affiliationsFromParticipations);
    console.log(`Found ${affiliationsArray.length} affiliations from participations`);
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
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${affiliationsArray.length} affiliations (${formatDuration(duration)})`);
    }
  }

  // Afflicationsのparticipationのurlもe.g. https://api.w3.org/affiliations/1057/participants"読んでデータを保存する
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
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${participantsArray.length} affiliation participants (${formatDuration(duration)})`);
    }
  }

  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} affiliations data (Errors: ${errorCount}) CollectedAffiliationsData entries:`, Object.keys(collectedAffiliationsData).length);
  return collectedAffiliationsData;
}

async function fetchUsers(collectedGroupsData, collectedParticipationsData, collectedAffiliationsData) {
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
      // links.usersがある場合はそのhrefを追加, これはindivisuals
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
  console.log('Found users from groups: ' + usersFromGroups.size);

  // patticipationsから全てのユーザーを抽出、Groupsに参加する組織メンバーは取得
  const usersFromParticipations = new Set();
  for (const url in collectedParticipationsData) {
    const entry = collectedParticipationsData[url];
    if (!entry || !entry.data) continue;
    const data = entry.data;
    // links.userがある場合はそのhrefを追加

    if (data._links && data._links.user && data._links.user.href) {
      // https://api.w3.org/users/${hash}
      usersFromParticipations.add(data._links.user.href);
    }

    // /participantsで終わる場合はparticipantsの中のhrefが/users/で始まるものだけ追加, member participations or IEs
    if (url.endsWith('/participants') && data._links && data._links.participants) {
      const participants = data._links.participants;
      if (Array.isArray(participants)) {
        // e.g. https://api.w3.org/users/${hash}
        for (const participant of participants) {
          if (participant && participant.href) {
            usersFromParticipations.add(participant.href);
          }
        }
      } else if (participants && typeof participants === 'object') {
        // e.g. https://api.w3.org/users/${hash}
        for (const participant of Object.values(participants)) {
          if (participant && participant.href) {
            usersFromParticipations.add(participant.href);
          }
        }
      }
    }
  }
  console.log('Found users from participations: ' + usersFromParticipations.size);

  // collectedAffiliationsDataから全参加者(users)を抽出
  const usersFromAffiliations = new Set();
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
                usersFromAffiliations.add(participant.href);
              }
            }
          } else if (participants && typeof participants === 'object') {
            for (const participant of Object.values(participants)) {
              if (participant && participant.href) {
                usersFromAffiliations.add(participant.href);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`Error fetching participants for affiliation ${url}: ${String(e)}`);
      }
    }
  }
  console.log(`Found users from affiliations: ${usersFromAffiliations.size}`);

  const usersInGroups = new Set([...usersFromGroups, ...usersFromParticipations])
  console.log('usersInGroup(i.e. users extracted in groups or participations:', usersInGroups.size)
  const usersNotInGroups = new Set([...usersFromAffiliations].filter(x => !usersFromParticipations.has(x)));
  console.log('usersNotInGroup(i.e. users in neither groups nor participations:', usersNotInGroups.size)

  let fetchUsers = usersFromParticipations;
  if (isSkipFetchUsersNotInGroups) {
    console.log('--- isSkipFetchUsersNotInGroups = true, fetch UsersData only groupParticipations');
    fetchUsers = usersInGroups;
  }

  const fetchUserHrefs = Array.from(fetchUsers);
  console.log("users to fetch:", fetchUserHrefs.length);

  let collectedUsersData = await fetchUsersData(fetchUserHrefs);

  return collectedUsersData
}


// global counters
let fetchCount = 0;
let fetchedCount = 0;
let errorCount = 0;
async function fetchCollectionDataAndUrlsSet(urlSet, processFunction) {
  const urlArray = Array.from(urlSet);
  let collectedData = {};
  let collectedUrlsSetList = [];
  for (let i = 0; i < urlArray.length; i++) {
    const url = urlArray[i];
    if (VERBOSE) console.log(`[${i + 1}/${urlArray.length}] Fetching: ${url}`);
    const { dataEntry, collectedUrlsArrayList } = await fetchDataEntryAndUrls(url, processFunction);
    collectedData[url] = dataEntry;
    // create set for each urlsArray
    for (const [index, urlsArray] of collectedUrlsArrayList.entries()) {
      if (!collectedUrlsSetList[index]) {
        collectedUrlsSetList[index] = new Set();
      }
      for (const u of urlsArray) {
        collectedUrlsSetList[index].add(u);
      }
    }
    if (VERBOSE) console.log(`    ✓ data fetched`);
    if (i % 100 === 0 || i === urlArray.length - 1) {
      const duration = Date.now() - phaseStartTimestamp;
      console.log(`    --- Progress: ${i + 1}/${urlArray.length} (${formatDuration(duration)})`);
    }
  }
  return { collectedData, collectedUrlsSetList };
}

async function fetchDataEntryAndUrls(url, processFunction) {
  let dataEntry = {
    fetchedAt: new Date().toUTCString(), // HTTP-date形式
    lastModified: undefined,
    data: undefined
  }
  let collectedUrlsArrayList = []
  try {
    fetchCount++;

    const { lastModified, data } = await fetchApiData(url, VERBOSE);
    dataEntry.lastModified = lastModified;
    dataEntry.data = data;

    collectedUrlsArrayList = processFunction(url, data);

    fetchedCount++;
  } catch (e) {
    if (VERBOSE) {
      console.warn(`error fetching ${url}: ${String(e)}`);
    }
    errorCount++;

    dataEntry.data = { error: String(e) };
  }
  return { dataEntry: dataEntry, collectedUrlsArrayList: collectedUrlsArrayList }
}

function processSpecificationLinks(url, data) {
  const seriesUrls = [];
  const versionHistoryUrls = [];
  const supercededUrls = [];
  const supercedesUrls = [];
  if (data?._links) {
    const links = data._links;
    if (links.series?.href) {
      const seriesUrl = links.series.href;
      if (!reSpecificationsSeries.test(seriesUrl)) {  // https://api.w3.org/specification-series/${short}
        console.log(`  → Warning illegal specification series URL: ${seriesUrl} at ${url}`);
      }
      seriesUrls.push(seriesUrl);
    }
    if (links['version-history']?.href) {
      const versionHistoryUrl = links['version-history'].href;
      if (!reSpecificationsVersionHistory.test(versionHistoryUrl)) { // https://api.w3.org/specifications/{short}/versions
        console.log(`  → Warning illegal specification version history URL: ${versionHistoryUrl} at ${url}`);
      }
      versionHistoryUrls.push(versionHistoryUrl);
    }
    if (links['superseded-by']) {
      const supersededByUrl = links['superseded-by'].href;
      if (!reSpecificationsSuperseded.test(supersededByUrl)) { // https://api.w3.org/specifications/{short}/supercededs
        console.log(`  → Warning illegal specification version superseded-by URL: ${supersededByUrl} at ${url}`);
      }
      supercededUrls.push(supersededByUrl);
    }
    if (links['supersedes']) {
      const supersedesUrl = links['supersedes'].href;
      if (!reSpecificationsSupersedes.test(supersedesUrl)) { // https://api.w3.org/specifications/{short}/supersedes
        console.log(`  → Warning illegal specification version supersedes URL: ${supersedesUrl} at ${url}`);
      }
      supercedesUrls.push(supersedesUrl);
    }
  }
  return [seriesUrls, versionHistoryUrls, supercededUrls, supercedesUrls]
}

async function collectSpecifications(collectSpecSet, currentSpecsSet) { // currentSpecsSet are already collected Set which is used to avoid duplicate fetches
  console.log(`collectSpecifications: start collectSpec: `, collectSpecSet.size);
  const {
    collectedData: collectedSpecsData,
    collectedUrlsSetList: collectedUrlsSetList
  } = await fetchCollectionDataAndUrlsSet(
    collectSpecSet, processSpecificationLinks // common function for specifications
  );
  const collectedSpecificationsData = collectedSpecsData
  const collectedSeriesSet = collectedUrlsSetList[0]; // series URL set
  const collectedVersionHistoriesSet = collectedUrlsSetList[1]; // version-history URL set
  const collectedSupersededSet = collectedUrlsSetList[2]; // superceeded-by URL set
  const collectedSupersedesSet = collectedUrlsSetList[3]; // supersedes URL set 

  // series　URLのfetchループで、series entriesのURLを収集
  console.log(`Finished fetching specifications. CollectedSpecsData entries:`, Object.keys(collectedSpecsData).length);
  console.log(`Found ${collectedSeriesSet.size} specification series to fetch`);
  console.log(`Found ${collectedVersionHistoriesSet.size} version histories to fetch`);
  console.log(`Found ${collectedSupersededSet.size} superseded to fetch`);
  console.log(`Found ${collectedSupersedesSet.size} supersedes to fetch`);

  console.log(`Fetching series specifications:`, collectedSeriesSet.size);
  // seriesのURLのfetchループで、 series specificationsのURLを収集
  const {
    collectedData: collectedSeriesSpecsData,
    collectedUrlsSetList: collectedSeriesSpecsSetList
  } = await fetchCollectionDataAndUrlsSet(
    collectedSeriesSet,
    (url, data) => {
      const seriesUrls = [];
      if (data && data._links && data._links.specifications && data._links.specifications.href) {
        const seriesSpecUrl = data._links.specifications.href;
        if (!reSpecificationSeriesSpecs.test(seriesSpecUrl)) {  // https://api.w3.org/specification-series/${short}/specifications
          console.log(`  → Warning illegal specifications series specifications URL: ${seriesSpecUrl} at ${url}`);
        }
        seriesUrls.push(seriesSpecUrl);
      }
      return [seriesUrls]
    }
  );
  Object.assign(collectedSpecificationsData, collectedSeriesSpecsData);
  const collectedSeriesSpecsListSet = collectedSeriesSpecsSetList[0]; // series specs URL set
  console.log(`Finish fetching series specifications. CollectedSeriesSpecsData entries:`, Object.keys(collectedSeriesSpecsData).length);
  console.log(`Found ${collectedSeriesSpecsListSet.size} series specs list to fetch`);

  // series specsのURLのfetchループで、 specs of series specのURLを収集（seriessuperceededされたspecsもとれる)
  console.log(`Start fetching series specs list:`, collectedSeriesSpecsListSet.size);

  const {
    collectedData: collectedSpecsInSeriesSpecsData,
    collectedUrlsSetList: collectedSpecsInSeriesSpecsSetList
  } = await fetchCollectionDataAndUrlsSet(
    collectedSeriesSpecsListSet,
    (url, data) => {
      const specUrls = [];
      if (data?._links?.specifications) {
        const specifications = data._links.specifications;
        if (!Array.isArray(specifications)) {
          console.log(`  → Warning: specifications is not an array at ${url}`);
        } else {
          for (const spec of data._links.specifications) {
            if (spec && spec.href) {
              const specUrl = spec.href;
              if (!reSpecificationsSpec.test(specUrl)) {  // https://api.w3.org/specifications/{short}
                console.log(`  → Warning illegal spec URL: ${specUrl} at ${url}`);
              }
              specUrls.push(specUrl);
            }
          }
        }
      }
      return [specUrls]
    }
  );
  Object.assign(collectedSpecificationsData, collectedSpecsInSeriesSpecsData);
  const collectedSpecsInSeriesSpecs = collectedSpecsInSeriesSpecsSetList[0]; // specs from series specs URL set
  console.log(`Finish fetching series specs list. CllectedSpecsInSeriesSpecsData entries:`, Object.keys(collectedSpecsInSeriesSpecsData).length);
  console.log(`Found ${collectedSpecsInSeriesSpecs.size} specs in series specs`);

  // series specsから取得したspecsでspecsSetに含まれていないものを抽出し、fetchして、再起的にseriesSet, versionHistoriesSet, supercededSet, supersedesSetを拡張する

  if (collectedSpecsInSeriesSpecs.size > 0) {
    const specsOnlyInSeriesSpecsSet = new Set([...collectedSpecsInSeriesSpecs].filter(url => !currentSpecsSet.has(url)));
    console.log(`Found specs only in the series specs: ${specsOnlyInSeriesSpecsSet.size}`);
    const specsOnlyInCurrentSpecsSet = new Set([...currentSpecsSet].filter(url => !collectedSpecsInSeriesSpecs.has(url)));
    console.log(`Found specs only in the current specs(informative): ${specsOnlyInCurrentSpecsSet.size}`);
    if (specsOnlyInSeriesSpecsSet.size === 0) {
      console.log('Info: Not found specs only in the series specs, no need to continue collection recursively.');
    } else {
      console.log(`Info: Found specs only in the series specs ${specsOnlyInSeriesSpecsSet.size}, continuing collection recursively.`);
      console.log('Total collected specs before merge: ' + currentSpecsSet.size);

      specsOnlyInSeriesSpecsSet.forEach(item => currentSpecsSet.add(item)); // add specsOnlyInSeriesSpecsSet before calling collectSpecifications again
      console.log('Total collected specs after merge: ' + currentSpecsSet.size);
      // call collectSpecifications with specsOnlyInSeriesSpecsSet recursively until no more new specs are found in series specs
      console.log(`Fetching ${specsOnlyInSeriesSpecsSet.size} specifications only in the series specs`);
      const {
        collectedSpecificationsData: additionalCollectedSpecsData,
        collectedSeriesSet: additionalSeriesSet,
        collectedVersionHistoriesSet: additionalVersionHistoriesSet,
        collectedSupersededSet: additionalSupersededSet,
        collectedSupersedesSet: additionalSupersedesSet
      } = await collectSpecifications(specsOnlyInSeriesSpecsSet, currentSpecsSet);

      // add all collected data to the return objects
      Object.assign(collectedSpecificationsData, additionalCollectedSpecsData); // add collected specs data
      additionalSeriesSet.forEach(item => collectedSeriesSet.add(item)); // update collectedSeriesSet
      additionalVersionHistoriesSet.forEach(item => collectedVersionHistoriesSet.add(item)); // update collectedVersionHistoriesSet
      additionalSupersededSet.forEach(item => collectedSupersededSet.add(item)); // update collectedSupersededSet
      additionalSupersedesSet.forEach(item => collectedSupersedesSet.add(item)); // update collectedSupersedesSet
    }
  }
  console.log(`collectSpecifications: finish collectSpecSet.size: `, collectSpecSet.size);
  return ({ collectedSpecificationsData, collectedSeriesSet, collectedVersionHistoriesSet, collectedSupersededSet, collectedSupersedesSet });
}

async function fetchSpecifications(collectedGroupsData = undefined) {
  console.log('start fetching Specifications');
  // 戻り値のaffiliationsデータ格納用オブジェクトを初期化
  let collectedSpecificationsData = {};
  fetchCount = 0, fetchedCount = 0, errorCount = 0; // reset global counters in each phases

  // specのリストのフェッチの開始
  const specUrl = `https://api.w3.org/specifications/`;
  console.log(`Start fetching the list of all specifications: ${specUrl}`);
  const {
    dataEntry,
    collectedUrlsArrayList
  } = await fetchDataEntryAndUrls(specUrl, (url, data) => {
    const specUrls = [];
    if (data?._links?.specifications) {
      const specifications = data._links.specifications;
      if (!Array.isArray(data._links.specifications)) {
        console.log(`  → Warning: specifications is not an array at ${url}`);
      } else {
        for (const specification of data._links.specifications) {
          if (specification && specification.href) {
            if (!reSpecificationsSpec.test(specification.href)) {  // https://api.w3.org/specifications/${short}
              console.log(`  → Warning illegal specification URL: ${specification.href} at ${url}`);
            }
            specUrls.push(specification.href);
          }
        }
      }
    }
    return [specUrls];
  });
  collectedSpecificationsData[specUrl] = dataEntry;
  let collectedSpecsSet = new Set(collectedUrlsArrayList[0]);
  console.log(`Finished fetching the specification list, collectedSpecsSet.size:`, collectedSpecsSet.size);
  console.log(`Found ${collectedSpecsSet.size} specifications from the specification list`);

  if (collectedGroupsData) { // フェッチするspecificationsリストをテストモード用に絞り込み 
    const groupsSpecsSet = new Set();
    // groupsの仕様(specifications)を収集
    for (const url in collectedGroupsData) {
      if (!reGroupSpecifications.test(url)) continue; // exclude not  https://api.w3.org/groups/{type}/{short}/specifications'
      const entry = collectedGroupsData[url];
      if (!entry || !entry.data) continue;
      const data = entry.data;
      if (!data) {
        console.log(`  → Warning: No data found for group specifications in collectedGroupsData: ${url}`);
        continue;
      }
      if (data._links?.specifications) {
        const specifications = data._links.specifications;
        if (!Array.isArray(specifications)) {
          console.log(`  → Warning: specifications is not an array at ${url}`);
        } else {
          for (const spec of data._links.specifications) {
            if (spec && spec.href) {
              if (!reSpecificationsSpec.test(spec.href)) {  // https://api.w3.org/specifications/{short}
                console.log(`  → Warning illegal specification URL: ${spec.href} at ${url}`);
              }
              groupsSpecsSet.add(spec.href);
            }
          }
        }
      }
    }
    collectedSpecsSet = groupsSpecsSet;  // change specsSet to only specs linked from groups
    console.log(`Running in TEST mode - fetching only specifications linked from the test groups:`, collectedSpecsSet.size);
  }

  // collectSpecifications、 series, version-history, superseded-by, supersedesのURLを収集
  console.log(`Start collectSpecifications for collectedSpecsSet.size:`, collectedSpecsSet.size);
  const {
    collectedSpecificationsData: collectedSpecsData,
    collectedSeriesSet: collectedSeriesSet,  // do not use collectedSeriesSet in the following processing
    collectedVersionHistoriesSet: collectedVersionHistoriesSet,
    collectedSupersededSet: collectedSupersededSet,
    collectedSupersedesSet: collectedSupersedesSet
  } = await collectSpecifications(collectedSpecsSet, collectedSpecsSet, new Set());
  Object.assign(collectedSpecificationsData, collectedSpecsData); // add collected specs data

  // version historyのfetchループ,  versionsのURLを収集
  console.log(`Finish collectSpecifications, collectedSpecsData entries:`, Object.keys(collectedSpecsData).length);
  console.log(`Found ${collectedSeriesSet.size} specification series (already fetched)`);
  console.log(`Found ${collectedVersionHistoriesSet.size} specification version histories to fetch`);
  console.log(`Found ${collectedSupersededSet.size} superseded to fetch`);
  console.log(`Found ${collectedSupersedesSet.size} supersedes to fetch`);

  console.log(`Start fetching specification version histories:`, collectedVersionHistoriesSet.size);
  const {
    collectedData: collectedVersionsData,
    collectedUrlsSetList: collectedVersionsSetList
  } = await fetchCollectionDataAndUrlsSet(
    collectedVersionHistoriesSet,
    (url, data) => {
      const versionUrls = [];
      if (data?._links['version-history']) {
        const versionHistory = data._links['version-history'];
        if (!Array.isArray(versionHistory)) {
          console.warn(`  → Warning: version-history is not an array at ${url}`);
        } else {
          for (const version of versionHistory) {  // array
            if (version && version.href) {
              if (!reSpecificationsVersion.test(version.href)) {   // https://api.w3.org/specifications/{short}/versions/{version}
                console.log(`  → Warning illegal specification version URL: ${version.href} at ${url}`);
              }
              versionUrls.push(version.href);
            }
          }

        }
      }
      return [versionUrls]
    }
  );
  Object.assign(collectedSpecificationsData, collectedVersionsData); // add collected histories data
  const collectedVersionsSet = collectedVersionsSetList[0]; // versions URL set
  console.log(`Finish fetching version histories:`, Object.keys(collectedVersionsData).length);
  console.log(`Found ${collectedVersionsSet.size} specification versions to fetch`);

  // superseded byのfetchループ,  supersededのデータを収集
  console.log(`Start fetching supersededs`, collectedSupersededSet.size);
  const {
    collectedData: collectedSupersededData,
    collectedUrlsSetList: collectedSupersededSpecsSetList // always empty
  } = await fetchCollectionDataAndUrlsSet(
    collectedSupersededSet,
    (url, data) => {
      // 追加で抽出するURLがなければ空配列を返す
      return [];  // return empty array
    }
  );
  Object.assign(collectedSpecificationsData, collectedSupersededData);  // add collected superseded data
  console.log(`Finished fetching supersededs, collectedSupersededData entries:`, Object.keys(collectedSupersededData).length);

  // superseded byのfetchループ,  supersededのデータを収集
  console.log(`Start fetching supersedes:`, collectedSupersedesSet.size);
  const {
    collectedData: collectedSupersedesData,
    collectedUrlsSetList: collectedSupersedesSpecsSetList // always empty
  } = await fetchCollectionDataAndUrlsSet(
    collectedSupersedesSet,
    (url, data) => {
      // 追加で抽出するURLがなければ空配列を返す
      return []; // return empty array
    }
  );
  Object.assign(collectedSpecificationsData, collectedSupersedesData);  // add collected supersedes data
  console.log(`Finished fetching supersedes, collectedSupersedesData entries:`, Object.keys(collectedSupersedesData).length);

  // 最後にspecification versionsのfetchループ, 一番時間かかる
  console.log(`Start fetching specifications verions:`, collectedVersionsSet.size);
  const {
    collectedData: collectedVersionDetailsData,
    collectedUrlsSetList: collectedVersionsDetailsSetList // always empty
  } = await fetchCollectionDataAndUrlsSet(
    collectedVersionsSet,
    (url, data) => {
      // 追加で抽出するURLがなければ空配列を返す
      return []; // return empty array
    }
  );
  Object.assign(collectedSpecificationsData, collectedVersionDetailsData); // add collected versions data
  console.log(`Finished fetching specification versions. collectedVersionDetailsData entries:`, Object.keys(collectedVersionDetailsData).length);

  // 終了
  console.log(`✓ Finished: Fetched ${fetchedCount}/${fetchCount} specification data (Errors: ${errorCount}) CollectedSpecificationsData entries:`, Object.keys(collectedSpecificationsData).length);
  return collectedSpecificationsData;
}

function loadApiData(dirPath, filenames, isLatest, isTestMode = false) {
  try {
    const dataFilename = makeFilename(filenames.data, isLatest, isTestMode);
    const mainData = readJsonFile(dirPath, dataFilename);
    if (mainData == undefined) {
      console.warn("Warrning: cannot read ", dataFilename);

      if (!isLatest) {
        return undefined;  // if isLatest false, error since the data file does not exist previous json data files
      }
      // if isLatest true, read the other json files.
    }

    const groupsFilename = makeFilename(filenames.groups, isLatest, isTestMode);
    const groupsData = readJsonFile(dirPath, groupsFilename);
    if (groupsData == undefined) {
      console.error("Error: cannot read ", groupsFilename)
      return undefined;
    }

    const participationsFilename = makeFilename(filenames.participations, isLatest, isTestMode);
    const participationsData = readJsonFile(dirPath, participationsFilename);
    if (participationsData == undefined) {
      console.error("Error: cannot read ", participationsFilename);
      return undefined;
    }

    const affiliationsFilename = makeFilename(filenames.affiliations, isLatest, isTestMode);
    const affiliationsData = readJsonFile(dirPath, affiliationsFilename);
    if (affiliationsData == undefined) {
      console.error("Error: cannot read ", affiliationsFilename);
      return undefined;
    }

    const usersFilename = makeFilename(filenames.users, isLatest, isTestMode);
    const usersData = readJsonFile(dirPath, usersFilename);
    if (usersData == undefined) {
      console.error("Error: cannot read ", usersFilename);
      return undefined;
    }

    const specificationsFilename = makeFilename(filenames.specifications, isLatest, isTestMode);
    const specificationsData = readJsonFile(dirPath, specificationsFilename);
    if (specificationsData == undefined) {
      console.warn("Warning: cannot read ", specificationsFilename);
    }

    const timelineFilename = makeFilename(filenames.timeline, isLatest, isTestMode);
    const timelineData = readJsonFile(dirPath, timelineFilename);
    if (timelineData == undefined) {
      console.warn("Warning: cannot read ", timelineFilename);
    }

    return { mainData, groupsData, participationsData, affiliationsData, usersData, specificationsData, timelineData };
  } catch (e) {
    console.log(e);
    return undefined;
  }
}

function createTimelineJsonFile(dirPath, filenames, finalizeTimestamp, testGroups, isTestMode) {
  logAlways('✓ creating a timeline json file');

  const eventApiData = loadApiData(dirPath, filenames, true, isTestMode);   // isLatest=true
  if (eventApiData == undefined) {
    return false;
  }
  const eventStats = makeStats(eventApiData);

  const prevApiData = loadApiData(dirPath, filenames, false, isTestMode);  // isLatest=false
  if (prevApiData == undefined) {
    // OK go thru since there is not previous data
  }
  const prevStats = prevApiData ? makeStats(prevApiData) : undefined;

  const prevTime = prevApiData?.mainData?._metadata.lastChecked; // round down
  const prevTimestamp = prevTime ? new Date(prevTime).getTime() : 0;
  const eventTime = new Date(finalizeTimestamp).toUTCString();
  const eventTimestamp = new Date(eventTime).getTime(); // this round-down ms to consistest prevTime made from lastChecked.
  const eventData = makeTimelineEventData(prevTimestamp, prevStats, eventTimestamp, eventStats);

  const collectedTimelineData = { ...eventData };

  const outputFilename = makeFilename(filenames.timeline, true, isTestMode);   // latest=true
  const createTime = eventTime;
  const phaseStartTime = eventTime;
  const phaseDuration = 0;
  const isFinished = createJsonFile("timeline", dirPath, outputFilename, collectedTimelineData,
    createTime, phaseStartTime, phaseDuration, testGroups);
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}

function createDataJsonFile(dirPath, filenames, finalizeTimestamp, isTestMode) {
  const usedFilenames = [filenames.groups, filenames.participations, filenames.affiliations, filenames.users, filenames.specifications, filenames.timeline];
  const dataFilename = makeFilename(filenames.data, false, isTestMode);   // isLatest=false
  const files = [];
  let testGroups = undefined;
  let phase1StartTime = undefined;
  let numUsedFiles = usedFilenames.length;

  let errorCount = 0;
  for (const filename of usedFilenames) {
    const latestFilename = makeFilename(filename, true, isTestMode); // isLatest=true
    try {
      const json = readJsonFile(dirPath, latestFilename);
      if (json == undefined) {
        if (filename == filenames.specifications) {
          console.warn("Warning: not found specification data file, skip", latestFilename)
          numUsedFiles--;
          continue;
        } else {
          console.error("Error: can not read ", latestFilename)
          return false;
        }
      }
      if (json.fileType === "groups") { // save the information in metadata of the groups file
        testGroups = json._metadata.testGroups; // this is from groups.
        phase1StartTime = json._metadata.startTime;
      }
      if (!json._metadata) {
        console.error(`Error: Missing _metadata in ${latestFilename}`);
        errorCount++;
      }
      if (json._metadata.filename != latestFilename) {
        // This causes since the just copy json files to latest json files, e.g. using copy-files-to-latest-files.sh
        console.warn(`Warning: The _metadata.filename ${json._metadata.filename} is not for ${latestFilename}. The latest file may be copyed using the copy-files-to-latest-files.sh.`);
      }

      if (!json._metadata.filename.includes(json._metadata.fileType)) {
        // old set file does not have fileType
        console.warn(`Warning: The _metadata.fileType ${json._metadata.type} of ${latestFilename} is not for ${filename}.`);
      }

      // change the filename
      const outputFilename = makeFilename(filename, false, isTestMode); // isLatest=false
      json._metadata.filename = outputFilename;

      files.push({ _metadata: json._metadata });
    } catch (e) {
      console.error(`Error: reading/parsing ${latestFilename}: ${e.message}`);
      errorCount++;
    }
  }

  if (errorCount != 0) {
    console.error(`Error: ${dataFilename} is not created errorCount=${errorCount}`)
    return false;
  }

  if (files.length == numUsedFiles) {
    const duration = phase1StartTime ? (finalizeTimestamp - new Date(phase1StartTime).getTime()) : 0;
    const metadata = {
      fileType: "data",
      filename: dataFilename,
      lastChecked: new Date(finalizeTimestamp).toUTCString(), // HTTP-date
      phaseStartTime: phase1StartTime,
      duration: formatDuration(duration),
      testGroups
    };
    const w3cData = {
      _metadata: metadata,
      files
    };
    const path = dirPath + '/' + dataFilename
    fs.writeFileSync(path, JSON.stringify(w3cData, null, 2), 'utf8');
    console.log(`✓ ${path} created successfully.`);
    return true;
  } else {
    console.error(`Error: ${dataFilename} not created because all files are not created the previous phases.`);
  }
  return false
}

async function phase1_fetchGroups(dirPath, groupsFilename, isTestMode = false) {
  // shouldFetchGroupsはmainで判定。isTestModeのみ引数で受け取る。
  logAlways('\n========== PHASE 1 (groups): Started ==========\n');
  phaseRequestCount = 0;
  const phaseStartTimestamp = Date.now();

  let collectedGroupsData = {};
  let testGroupsShortNamesMap = {};  // テストでのtypeごとのshortname配列を格納するオブジェクト
  if (isTestMode) {
    // typeごとにshortnameリストを作成
    for (const { type, shortname } of testGroupsList) {
      if (!testGroupsShortNamesMap[type]) testGroupsShortNamesMap[type] = [];
      testGroupsShortNamesMap[type].push(shortname);
    }
    logAlways(`Running in TEST mode - fetching ${testGroupsList.length} sample groups\n`);
  }
  // groupをフェッチ
  const groupTypes = ['wg', 'ig', 'cg', 'tf', 'other'];
  const testGroups = [];
  for (let i = 0; i < groupTypes.length; i++) {
    const type = groupTypes[i];
    const testGroupShortNames = testGroupsShortNamesMap[type]; // テストモード時のみshortname配列を渡す
    if (isTestMode) {
      if (testGroupShortNames == undefined) {
        // テストモードでかつ該当typeのshortnameがundefinedの場合はスキップ
        continue;
      }
      testGroups.push(...testGroupShortNames);
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
  const currentTimestamp = Date.now();
  const phaseDurationMs = (currentTimestamp - phaseStartTimestamp);
  const phaseDuration = formatDuration(phaseDurationMs);
  logAlways(`Phase duration: ${phaseDuration}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / (phaseDurationMs / 1000.0)).toFixed(2)}`);
  phaseRequestCounts[0] = phaseRequestCount;

  const latestFilename = makeFilename(groupsFilename, true, isTestMode);  //isLatest=true
  const createTime = new Date(currentTimestamp).toUTCString();
  const phaseStartTime = new Date(phaseStartTimestamp).toISOString();
  const isFinished = createJsonFile("groups", dirPath, latestFilename, collectedGroupsData,
    createTime, phaseStartTime, phaseDuration,
    testGroups.length > 0 ? testGroups : undefined,
  );
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}

async function phase2_fetchParticipations(dirPath, participationsFilename, groupsFilename, isTestMode) {
  logAlways('\n========== PHASE 2: Fetching Participations ==========\n');
  phaseRequestCount = 0;
  const phaseStartTimestamp = Date.now();

  if (isTestMode) {
    console.log('Running in TEST mode - fetching participations only of the sample groups data.\n');  // membersとIEのみ、indivaidualのaffiliationsはfetchしない
  }

  // groupsデータを都度ロード
  let collectedGroupsData = {};
  let testGroups = undefined;
  try {
    const latestFilename = makeFilename(groupsFilename, true, isTestMode);  // isLatest=true
    collectedGroupsData = readJsonFile(dirPath, latestFilename);
    testGroups = collectedGroupsData._metadata.testGroups;
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} entries of groups data.`);
    if (!testGroups) {
      if (isTestMode) {
        console.error(`Error: running in TestMode, but the group data file ${latestFilename} was not generated in TestMode.`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.error(`Error: Cannot load the group file: ${e.message}`);
    process.exit(1);
  }
  // participationデータは空で開始
  let collectedParticipationsData = await fetchParticipations(collectedGroupsData); // fetch participations based on the collectedGroupsData
  logAlways(`\n========== PHASE 2 (participations): Finished ==========`);
  logAlways(`Total participations data collected: ${Object.keys(collectedParticipationsData).length}`);
  const currentTimestamp = Date.now();
  const phaseDurationMs = (currentTimestamp - phaseStartTimestamp);
  const phaseDuration = formatDuration(phaseDurationMs);
  logAlways(`Phase duration: ${phaseDuration}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / (phaseDurationMs / 1000.0)).toFixed(2)}`);
  phaseRequestCounts[2] = phaseRequestCount;

  const latestFilename = makeFilename(participationsFilename, true, isTestMode);  // isLatest=true
  const createTime = new Date(currentTimestamp).toUTCString();
  const phaseStartTime = new Date(phaseStartTimestamp).toISOString();
  const isFinished = createJsonFile("participations", dirPath, latestFilename, collectedParticipationsData,
    createTime, phaseStartTime, phaseDuration,
    testGroups);
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}


// PHASE 3 Affiliations
async function phase3_fetchAffiliations(dirPath, affiliationsFilename, participationFilename, isTestMode) {
  logAlways('\n========== PHASE 3 (affiliations): Started ==========\n');
  phaseRequestCount = 0;
  const phaseStartTimestamp = Date.now();

  let collectedParticipationsData = undefined
  let testGroups = undefined;

  if (isTestMode) {
    console.log('Running in TEST mode - fetching only affiliations only of the sample groups.\n');  // membersとIEのみ、indivaidualのaffiliationsはfetchしない
    console.log(' - Note that TEST mode can not correctly handle W3C staff and  member participations of the exception groups who has no member participation list, since it does not fetch affiliations of thems..\n');

    // テストモードではparticipationsデータを都度ロード, participataionsだけのAfflicationsをとるのに利用。
    try {
      const latestFilename = makeFilename(participationFilename, true, isTestMode); // isLatest=true
      collectedParticipationsData = readJsonFile(dirPath, latestFilename);
      testGroups = collectedParticipationsData._metadata.testGroups;
      logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} entries of participations data.`);
    } catch (e) {
      console.error(`Error: Cannot load the participation file: ${e.message}`);
      process.exit(1);
    }
  }

  const collectedAffiliationsData = await fetchAffiliations(collectedParticipationsData);
  logAlways(`\n========== PHASE 3 (affiliations): Finished ==========`);
  logAlways(`Total affiliations data collected: ${Object.keys(collectedAffiliationsData).length}`);
  const currentTimestamp = Date.now();
  const phaseDurationMs = (currentTimestamp - phaseStartTimestamp);
  const phaseDuration = formatDuration(phaseDurationMs);
  logAlways(`Phase duration: ${phaseDuration}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / (phaseDurationMs / 1000.0)).toFixed(2)}`);
  phaseRequestCounts[4] = phaseRequestCount;

  const latestFilename = makeFilename(affiliationsFilename, true, isTestMode); // isLatest=true
  const createTime = new Date(currentTimestamp).toUTCString();
  const phaseStartTime = new Date(phaseStartTimestamp).toISOString();
  const isFinished = createJsonFile("affiliations", dirPath, latestFilename, collectedAffiliationsData,
    createTime, phaseStartTime, phaseDuration,
    testGroups);
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}

// PHASE 4: Users
async function phase4_fetchUsers(dirPath, usersFilename, groupsFilename, participationsFilename, affiliationsFilename, isTestMode) {
  logAlways('\n========== PHASE 4 (users): Started ==========\n');
  phaseRequestCount = 0;
  const phaseStartTimestamp = Date.now();

  if (isTestMode) {
    console.log('Running in TEST mode - fetching only users found of the sample groups.\n');
  }

  // groups データを都度ロード
  let collectedGroupsData = {};
  let testGroups = undefined;
  try {
    const latestFilename = makeFilename(groupsFilename, true, isTestMode);  // isLatest=true
    collectedGroupsData = readJsonFile(dirPath, latestFilename);
    logAlways(`Loaded ${Object.keys(collectedGroupsData).length} entries of groups data.`);
    testGroups = collectedGroupsData._metadata.testGroups;
    if (!testGroups) {
      if (isTestMode) {
        logAlways(`The groups data is about ${testGroups.length} sample groups\n`);
      } else {
        console.error(`Error: running in TestMode, but the group data file ${latestFilename} was not generated in TestMode.`);
      }
    }
  } catch (e) {
    console.error(`Error: Cannot load the affilication file:  ${e.message}`);
    process.exit(1);
  }

  let collectedParticipationsData = {};
  try {
    const latestFilename = makeFilename(participationsFilename, true, isTestMode);  // isLatest=true
    collectedParticipationsData = readJsonFile(dirPath, latestFilename);
    logAlways(`Loaded ${Object.keys(collectedParticipationsData).length} entries of participations data.`);
    if (!testGroups) {
      if (isTestMode) {
        logAlways(`The participations data is about ${testGroups.length} sample groups\n`);
      } else {
        console.error(`Error: running in TestMode, but the participations data file ${latestFilename} was not generated in TestMode.`);
      }
    }
    if (JSON.stringify(testGroups) !== JSON.stringify(collectedParticipationsData?._metadata?.testGroups)) {
      console.error('Error: : The participations data has a mismatched testGroups of the groups data.');
      return false;
    }
  } catch (e) {
    console.error(`Error: Cannot load the affilication file:  ${e.message}`);
    process.exit(1);
  }

  // affiliationsデータを都度ロード
  let collectedAffiliationsData = {};
  try {
    const latestFilename = makeFilename(affiliationsFilename, true, isTestMode); // isLatest=true
    collectedAffiliationsData = readJsonFile(dirPath, latestFilename);
    logAlways(`Loaded ${Object.keys(collectedAffiliationsData).length} entries of affiliations data.`);
    if (!testGroups) {
      if (isTestMode) {
        logAlways(`The affiliation data is about ${testGroups.length} sample groups\n`);
      } else {
        console.error(`Error: running in TestMode, but the affliation data file ${latestFilename} was not generated in TestMode.`);
      }
    }
    if (JSON.stringify(testGroups) !== JSON.stringify(collectedAffiliationsData?._metadata?.testGroups)) {
      console.error('Error: affiliationsData has a mismatched testGroups of the group data.');
      return false;
    }
  } catch (e) {
    console.error(`Error: Cannot load the affilication file:  ${e.message}`);
    return false;
  }
  // usersデータは空で開始
  let collectedUsersData = await fetchUsers(collectedGroupsData, collectedParticipationsData, collectedAffiliationsData);
  logAlways(`\n========== PHASE 4 (users): Finished ==========`);
  logAlways(`Total users data collected: ${Object.keys(collectedUsersData).length}`);
  const currentTimestamp = Date.now();
  const phaseDurationMs = (currentTimestamp - phaseStartTimestamp);
  const phaseDuration = formatDuration(phaseDurationMs);
  logAlways(`Phase duration: ${phaseDuration}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / (phaseDurationMs / 1000.0)).toFixed(2)}`);
  phaseRequestCounts[3] = phaseRequestCount;

  const latestFilename = makeFilename(usersFilename, true, isTestMode);  // isLatest=true
  const createTime = new Date(currentTimestamp).toUTCString();
  const phaseStartTime = new Date(phaseStartTimestamp).toISOString();
  const isFinished = createJsonFile("users", dirPath, latestFilename, collectedUsersData,
    createTime, phaseStartTime, phaseDuration,
    testGroups);
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}

async function phase5_fetchSpecifications(dirPath, specificationsFilename, groupsFilename, isTestMode) {
  logAlways('\n========== PHASE 5: Fetching Specifications ==========\n');

  phaseRequestCount = 0;
  const phaseStartTimestamp = Date.now();

  if (isTestMode) {
    console.log('Running in TEST mode - fetching specifications only of the sample groups.\n');
  }


  let collectedGroupsData = undefined;
  let testGroups = undefined;
  if (isTestMode) {
    try {
      const latestFilename = makeFilename(groupsFilename, true, isTestMode);  // isLatest = true
      collectedGroupsData = readJsonFile(dirPath, latestFilename);
      testGroups = collectedGroupsData._metadata.testGroups;
      logAlways(`Loaded ${Object.keys(collectedGroupsData).length} entries of groups data.`);
      if (!testGroups) {
        if (isTestMode) {
          logAlways(`The group data is about ${testGroups.length} sample groups\n`);
        } else {
          console.error(`Error: running in TestMode, but the group data file ${latestFilename} was not generated in TestMode.`);
          return false;
        }
      }
    } catch (e) {
      console.error(`Error: Cannot load w3c-groups.json: ${e.message}`);
      process.exit(1);
    }
  }

  // specificationsデータは空で開始
  let collectedSpecificationsData = await fetchSpecifications(collectedGroupsData);
  logAlways(`\n========== PHASE 5 (specifications): Finished ==========`);
  logAlways(`Total specifications data collected: ${Object.keys(collectedSpecificationsData).length}`);
  const currentTimestamp = Date.now();
  const phaseDurationMs = (currentTimestamp - phaseStartTimestamp);
  const phaseDuration = formatDuration(phaseDurationMs);
  logAlways(`Phase duration: ${phaseDuration}`);
  logAlways(`Total requests: ${phaseRequestCount}`);
  logAlways(`Average requests/sec: ${(phaseRequestCount / (phaseDurationMs / 1000.0)).toFixed(2)}`);
  phaseRequestCounts[6] = phaseRequestCount;

  const latestFilename = makeFilename(specificationsFilename, true, isTestMode);  // isLatest=true
  const createTime = new Date(currentTimestamp).toUTCString();
  const phaseStartTime = new Date(phaseStartTimestamp).toISOString();
  const isFinished = createJsonFile("specifications", dirPath, latestFilename, collectedSpecificationsData,
    createTime, phaseStartTime, phaseDuration,
    testGroups);
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;
}

async function phase6_finalize(dirPath, filenames, isTestMode) {
  logAlways('\n========== PHASE 6: Finalizing ==========\n');
  if (isTestMode) {
    console.log('Running in TEST mode - generating a data file and a timeline file only of the sample groups.\n');
  }

  try {
    let prevEpochSeconds = 0;
    const finalizeTimestamp = Date.now();

    if (REMAKE_TIMELINE) {
      if (isTestMode) {
        console.warn('Warning: can not remake a timeline json file in TestMode');
      } else {
        if (!remakeTimelineJsonFile(dirPath, filenames)) {
          logAlways('\n========== PHASE 6: Failed remaking timeline json file in phase6_finalize ==========');
          return false;
        }
        // check the remaked timeline
        if (!checkTimelineJsonFile(dirPath, filenames, false, isTestMode)) { // isLetest=false
          logAlways('\n========== PHASE 6: Failed checking remakeTimeline in phase6_finalize ==========');
          return false;
        }
        logAlways(`✓ The timeline json file is remade.`)
      }
    }

    logAlways(`✓ checking the timestamps in order json files and reading the json files.`);

    // check if files are created in the order of phases
    const latestGroupsFilename = makeFilename(filenames.groups, true, isTestMode);  // isLatest=true
    const collectedGroupsData = readJsonFile(dirPath, latestGroupsFilename);
    if (!collectedGroupsData) {
      console.error(`Error: a latest groups json file ${latestGroupsFilename} is not created, please run phase1.`)
      return false;
    } else {
      const lastChecked = collectedGroupsData._metadata.lastChecked;
      const epochSeconds = Math.floor(new Date(lastChecked).getTime() / 1000);
      prevEpochSeconds = epochSeconds;
    }
    const latestParticipationsFilename = makeFilename(filenames.participations, true, isTestMode);  // isLatest=true
    const collectedParticipationsData = readJsonFile(dirPath, latestParticipationsFilename);
    if (!collectedParticipationsData) {
      console.error(`Error: a latest participations json file ${latestParticipationsFilename}  is not created, please run from phase2.`);
      return false;
    } else {
      const lastChecked = collectedParticipationsData._metadata.lastChecked;
      const epochSeconds = Math.floor(new Date(lastChecked).getTime() / 1000);
      if (prevEpochSeconds > epochSeconds) {
        console.error(`Error: The latest groups json file ${latestGroupsFilename} is newer than the partipations json, please run from phase2.`);
        return false;
      }
      prevEpochSeconds = epochSeconds;
    }

    const latestAffiliationsFilename = makeFilename(filenames.affiliations, true, isTestMode);  // isLatest=true
    const collectedAffiliationsData = readJsonFile(dirPath, latestAffiliationsFilename);
    if (!collectedAffiliationsData) {
      console.error(`Error: a latest affiliations json file ${latestAffiliationsFilename} is not created, please run from phase3.`);
      errorCount++;
    } else {
      const lastChecked = collectedAffiliationsData._metadata.lastChecked;
      const epochSeconds = Math.floor(new Date(lastChecked).getTime() / 1000);
      if (prevEpochSeconds > epochSeconds) {
        console.error(`Error: The latest paticipations json file ${latestParticipationsFilename} is newer than the affiliations json, please run from phase3.`);
        return false;
      }
      prevEpochSeconds = epochSeconds;
    }

    const latestUsersFilename = makeFilename(filenames.users, true, isTestMode);  // isLatest=true
    const collectedUsersData = readJsonFile(dirPath, latestUsersFilename);
    if (!collectedUsersData) {
      console.error(`Error: a latest users json file {latestUsersFilename} is not created, please run phase4.`);
      errorCount++;
    } else {
      const lastChecked = collectedUsersData._metadata.lastChecked;
      const epochSeconds = Math.floor(new Date(lastChecked).getTime() / 1000);
      if (prevEpochSeconds > epochSeconds) {
        console.error(`Error: The latest users json file ${latestUsersFilename} is newer than the participations json, please run from phase4.`)
        return false;
      }
      prevEpochSeconds = epochSeconds;
    }

    const latestSpecificationsFilename = makeFilename(filenames.specifications, true, isTestMode); // isLatest=true
    const collectedSpecificationsData = readJsonFile(dirPath, latestSpecificationsFilename);
    if (!collectedSpecificationsData) {
      console.error(`Error: a latest specifications json file$ {latestSpecificationsFilename} is not created, please run from phase5.`);
      errorCount++;
    } else {
      const lastChecked = collectedSpecificationsData._metadata.lastChecked;
      const epochSeconds = Math.floor(new Date(lastChecked).getTime() / 1000);
      if (prevEpochSeconds > epochSeconds) {
        console.error(`Error: The latest users json file ${latestSpecificationsFilename} is newer than the specifications json, please run from phase5.`);
        return false;
      }
      prevEpochSeconds = epochSeconds;
    }
    logAlways(`✓ ok with the all json files.`);

    const testGroups = collectedGroupsData._metadata.testGroups;
    if (!createTimelineJsonFile(dirPath, filenames, finalizeTimestamp, testGroups, isTestMode)) {
      logAlways('\n========== PHASE 6: Failed at createTimelineJsonFile ==========');
      return false;
    };

    if (!checkTimelineJsonFile(dirPath, filenames, true, isTestMode)) {  // isLatest=true
      logAlways('\n========== PHASE 6: Failed at checkTimelineJsonFile ==========');
      return false;
    }

    // read the created timeline json file again
    const latestTimelineFilename = makeFilename(filenames.timeline, true, isTestMode); // isLatest = true
    const collectedTimelineData = readJsonFile(dirPath, latestTimelineFilename);

    // update  json files with the latest json files
    logAlways('✓ update all the json files by comparing with all the latest json files.');
    compareWithLatestAndWriteJsonFile("groups", dirPath, filenames.groups, collectedGroupsData, isTestMode);
    compareWithLatestAndWriteJsonFile("participations", dirPath, filenames.participations, collectedParticipationsData, isTestMode);
    compareWithLatestAndWriteJsonFile("affiliations", dirPath, filenames.affiliations, collectedAffiliationsData, isTestMode);
    compareWithLatestAndWriteJsonFile("users", dirPath, filenames.users, collectedUsersData, isTestMode);
    if (collectedSpecificationsData == undefined) {
      // Note that an old data set does not have the spec json data
      console.warn("Warning skip updating specification json file since no latest json files.")
    } else {
      compareWithLatestAndWriteJsonFile("specifications", dirPath, filenames.specifications, collectedSpecificationsData, isTestMode);
    }
    compareWithLatestAndWriteJsonFile("timeline", dirPath, filenames.timeline, collectedTimelineData, isTestMode);

    // alreays createDataJson files, regardless other json files are updated or not. Because all fetch is done.
    if (!createDataJsonFile(dirPath, filenames, finalizeTimestamp, isTestMode)) {
      logAlways('\n========== PHASE 6: Failed at createDataJsonFile ==========');
    } else {
      logAlways('✓ remove all latest json files.');
      removeJsonFile(dirPath, latestGroupsFilename, isTestMode);
      removeJsonFile(dirPath, latestParticipationsFilename, isTestMode);
      removeJsonFile(dirPath, latestAffiliationsFilename, isTestMode);
      removeJsonFile(dirPath, latestUsersFilename, isTestMode);
      if (collectedSpecificationsData != undefined) {
        removeJsonFile(dirPath, latestSpecificationsFilename, isTestMode);
      }
      removeJsonFile(dirPath, latestTimelineFilename, isTestMode);
      logAlways('✓ Finished.');
    }
    logAlways('\n========== PHASE 6: Finished ==========');
  } catch (e) {
    console.log(e);
    return false;
  }
  return true;
}


function printUsage() {
  console.log(`\nUsage:
  node scripts/fetch-w3c-data.js                    # All Phases: Fetch all data (All Phases: groups + participations + affiliations + users)
  node scripts/fetch-w3c-data.js --groups --test    # Test mode (only sample groups)
  node scripts/fetch-w3c-data.js --groups           # Only Phase1: update groups, participations lists, users lists in w3c-groups.json
  node scripts/fetch-w3c-data.js --participations   # Only Phase2: update participation details in w3c-participations.json (requires w3c-groups.json)
   node scripts/fetch-w3c-data.js --users           # Only Phase3: update user details in w3c-users.json (requires w3c-participations.json and w3c-affiliations.json)
  node scripts/fetch-w3c-data.js --affiliations     # Only Phase4: update affiliations in w3c-affiliations.json (requires w3c-participations.json)
  node scripts/fetch-w3c-data.js --specifications  # Only Phase6: update specifications in w3c-specifications.json (requires w3c-participations.json and w3c-users.json)
  node scripts/fetch-w3c-data.js --groups --participations  # Only Phase1 and Phase2: update groups and participations
   node scripts/fetch-w3c-data.js --remakeTimeline # RemakeTimeline json file on Phase6
  node scripts/fetch-w3c-data.js --verbose          # Show detailed fetch logs\n`);
}

async function main() {
  const dirPath = './data';
  phaseStartTimestamp = Date.now();
  const now = new Date(phaseStartTimestamp);
  const phaseStartTime = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/T/, '-')
    .split('.')[0];
  console.log(`Fetch started at: ${phaseStartTime}`);
  const allowedOptions = [
    '--groups', '--test', '--participations', '--users', '--affiliations', '--phase1', '--phase2', '--phase3', '--phase4', '--phase5', '--phase6',
    '--remakeTimeline', '--verbose', '--help', '-h'
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
  const isFetchGroups = process.argv.includes('--groups') || process.argv.includes('--phase1');
  const isFetchParticipations = process.argv.includes('--participations') || process.argv.includes('--phase2');
  const isFetchAffiliations = process.argv.includes('--affiliations') || process.argv.includes('--phase3');
  const isFetchUsers = process.argv.includes('--users') || process.argv.includes('--phase4');
  const isFetchSpecifications = process.argv.includes('--specifications') || process.argv.includes('--phase5');
  const isFinalize = process.argv.includes('--finanize') || process.argv.includes('--phase6')
  const isAllPhases = !isFetchGroups && !isFetchParticipations && !isFetchAffiliations && !isFetchUsers && !isFetchSpecifications && !isFinalize;

  const fileNames = {
    data: 'w3c-data.json',
    timeline: 'w3c-timeline.json',
    groups: 'w3c-groups.json',
    participations: 'w3c-participations.json',
    users: 'w3c-users.json',
    affiliations: 'w3c-affiliations.json',
    specifications: 'w3c-specifications.json',
  };

  let phase1Finished = false;
  let phase2Finished = false;
  let phase3Finished = false;
  let phase4Finished = false;
  let phase5Finished = false;
  let phase6Finished = false;

  if (isAllPhases || isFetchGroups) {
    phase1Finished = await phase1_fetchGroups(dirPath, fileNames.groups, isTestMode);
    if (!phase1Finished) {
      console.log('Phase1 failed');
    }
  }
  if ((isAllPhases && phase1Finished) || isFetchParticipations) {
    phase2Finished = await phase2_fetchParticipations(dirPath, fileNames.participations, fileNames.groups, isTestMode);
    if (!phase2Finished) {
      console.log('Phase2 failed');
    }
  }
  if ((isAllPhases && phase2Finished) || isFetchAffiliations) {
    phase3Finished = await phase3_fetchAffiliations(dirPath, fileNames.affiliations, fileNames.participations, isTestMode);
    if (!phase3Finished) {
      console.log('Phase3 failed');
    }
  }
  if ((isAllPhases && phase3Finished) || isFetchUsers) {
    phase4Finished = await phase4_fetchUsers(dirPath, fileNames.users, fileNames.groups, fileNames.participations, fileNames.affiliations, isTestMode);
    if (!phase4Finished) {
      console.log('Phase4 failed');
    }
  }

  if ((isAllPhases && phase4Finished) || isFetchSpecifications) {
    phase5Finished = await phase5_fetchSpecifications(dirPath, fileNames.specifications, fileNames.groups, isTestMode);
    if (!phase5Finished) {
      console.log('Phase5 failed');
    }
  }
  if ((isAllPhases && phase5Finished) || isFinalize) {
    phase6Finished = await phase6_finalize(dirPath, fileNames, isTestMode);
    if (!phase6Finished) {
      console.log('Phase6 failed');
    }
  }

  if (phase1Finished && phase2Finished && phase3Finished && phase4Finished && phase5Finished && phase6Finished) {
    console.log('All done.');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});


// remake the w3c-timeline.json using the snapshot data under './data-snapshots'.

function remakeTimelineJsonFile(dirPath, filenames) {
  const DATA_DIR = 'data';
  const SNAPSHOTS_DIR = 'data-snapshots';
  const SNAPSHOT_DIR_PREFIX = 'w3c-data-';

  logAlways(`✓ remakeTimelineJsonFiles with json files under the dir ${SNAPSHOTS_DIR} and ${DATA_DIR}.`);
  // all files including the data json must be exists in ${DIR_DIR} to remake timeline
  const dataPaths = fs
    .readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter(d =>
      d.isDirectory() &&
      d.name.startsWith(SNAPSHOT_DIR_PREFIX)
    )
    .sort() // YYYY-MM-DD 形式なので文字列ソート = 時系列
    .map(d => path.join(SNAPSHOTS_DIR, d.name));

  if (dataPaths.length == 0) {
    console.error(`No snapshot directory with prefix=${SNAPSHOT_DIR_PREFIX} found under ${SNAPSHOTS_DIR}`);
    return false;
  }

  // dataPaths.push(DATA_DIR); // do not add DATA_DIR assuming it is the same as the latest data-snapshot

  for (const [i, path] of Object.entries(dataPaths)) {
    logAlways(` Info: dataPath[${i}]: ${path}`);
  }

  let eventTimestamp = 0;
  const collectedTimelineData = {};
  for (let i = 0; i < dataPaths.length; i++) {
    const eventPath = dataPaths[i];
    const prevPath = i === 0 ? undefined : dataPaths[i - 1];

    const eventApiData = loadApiData(eventPath, filenames, false, false);  //  isLatest=false, isTestMode = false
    if (eventApiData == undefined) {
      console.error("Error: can not load api data", eventPath);
      return false;
    }

    const eventStats = makeStats(eventApiData);
    const eventTime = eventApiData.mainData?._metadata.lastChecked   // use mainData latestCheckedtime for eventTime
    eventTimestamp = new Date(eventTime).getTime();

    let prevStats = undefined;
    let prevTimestamp = 0;
    if (prevPath) {
      const prevApiData = loadApiData(prevPath, filenames, false, false);  //  isLatest=false, isTestMode = false
      if (prevApiData == undefined) {
        console.error("Error: can not load api data", prevData);
        return false;
      }
      prevStats = makeStats(prevApiData);
      const prevTime = prevApiData.mainData?._metadata.lastChecked;
      prevTimestamp = new Date(prevTime).getTime();

      // check consistency of timestamp
      if (prevTimestamp > eventTimestamp) {
        console.error(`Warning: prevTimestamp=${prevTimestamp}: ${new Date(prevTimestamp)} of ${prevPath} is bigger than the eventTimestamp=${eventTimestamp}: ${new Date(eventTimestamp)} ${eventPath}`)
        return false;
      }

      function checkDataTimestamp(filename, eventData, prevData) {
        const eventTime = new Date(eventData?._metadata.lastChecked ?? 0);
        const prevTime = new Date(prevData?._metadata.lastChecked ?? 0);
        if (eventTime.getTime() >= prevTime.getTime()) {
          return true;
        }
        console.error(`Error: prevTime ${prevTime} is older than the eventTime: ${eventTime}:`, filename);
        return false;
      }

      if (!checkDataTimestamp(filenames.groups, eventApiData.groupsData, prevApiData.groupsData) &&
        !checkDataTimestamp(filenames.participations, eventApiData.participationsData, prevApiData.participationsData) &&
        !checkDataTimestamp(filenames.affiliations, eventApiData.affiliationsData, prevApiData.affiliationsData) &&
        !checkDataTimestamp(filenames.users, eventApiData.usersData, prevApiData.usersData) &&
        !checkDataTimestamp(filenames.specifications, eventApiData.specificationsData, prevApiData.specificationsData)) {
        return false;
      }
    }

    const eventData = makeTimelineEventData(prevTimestamp, prevStats, eventTimestamp, eventStats);
    if (eventData == undefined) {
      return false;
    }

    Object.assign(collectedTimelineData, eventData); // add eventData
  }

  const timelineFilename = makeFilename(filenames.timeline, false, false); // isLatest=false, isTestMode=false, no need to create latest file and no TestMode in remakeTimelinefiles();
  const createTime = new Date(eventTimestamp).toUTCString();
  const phaseStartTime = createTime;
  const phaseDuration = formatDuration(0);
  const isFinished = createJsonFile("timeline", dirPath, timelineFilename, collectedTimelineData,
    createTime, phaseStartTime, phaseDuration, undefined); // eventTimestamp is the last eventTimestamp
  if (isFinished) {
    logAlways('✓ Finished.');
  }
  return isFinished;

}

function checkTimelineJsonFile(dirPath, filenames, isLatest, isTestMode) {
  logAlways(`✓ checkTimelineJsonFile under ${dirPath}.`);

  try {
    const timelineFilename = makeFilename(filenames.timeline, isLatest, isTestMode); // isLatest=fale
    if (!fs.existsSync(`${dirPath}/${timelineFilename}`)) {
      console.error(`Error: Not found the timeline json file ${timelineFilename}.`)
      return false;
    }
    const apiData = loadApiData(dirPath, filenames, isLatest, isTestMode);  //  isLatest=false
    if (apiData == undefined) {
      console.error("Error: can not load api data", dirPath);
      return false;
    }

    const collectedTimelineData = apiData.timelineData;
    if (collectedTimelineData == undefined) {
      console.error("Error checkTimelineJsonFile no timeline");
      return false;
    }

    if (!checkTimelineData(collectedTimelineData)) {
      console.error("Error checkTimelineJsonFile checkTimelineData failed.");
      return false;
    }
    logAlways(`✓ checkTimelineJsonFile ok.`);
    return true;
  } catch (e) {
    console.error(e);
  }

  logAlways(`✓ checkTimelineJsonFile ng.`);
  return false;
}