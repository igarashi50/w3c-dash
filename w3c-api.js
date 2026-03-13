// w3c-api.js

/* Export the following two functions.
export async function fetchDataAsync(targetUrl)
export async function loadApiDataAsync()
*/

// The code of fetchApiData functions is copeied from fetch-data.js
// The fetch Json uses the fetch() function of browsers to fetch Data from the W3C API via the Internet
// グローバル変数廃止。各Phase関数で都度ファイルロード・ローカル変数化。
let totalRequestCount = 0; // 全体のfetchJson呼び出し回数

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 統一されたリクエスト間隔
// W3C API制限: 6000 requests per IP every 10 minutes
// 200ms間隔 = 5 requests/sec = 300 requests/min = 3000 requests/10min (制限の50%使用)
// const REQUEST_INTERVAL = 200;
const REQUEST_INTERVAL = 0; // No need to wait between requests in browser environment  

async function fetchJson(url, retries = 6, backoffMs = 60000, timeoutMs = 180000, redirects = 5, verbose = false) { // no need to support redirects for fetch()
  totalRequestCount++;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (verbose) {
        console.log(`    [REQUEST] ${url}`);
      }
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        redirect: 'follow'
      });
      if (!res.ok) {
        const text = await res.text();
        // 429/5xxはリトライ
        if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < retries - 1) {
          let wait = backoffMs;
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
              const ra = parseInt(retryAfter, 10);
              if (!isNaN(ra)) wait = ra * 1000;
            }
          }
          if (verbose) {
            console.warn(`    [RETRY] ${url} (HTTP ${res.status}) (${attempt + 1}/${retries}) wait ${wait}ms`);
          }
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        // それ以外はエラー返却
        throw {
          statusCode: res.status,
          url,
          headers: Object.fromEntries(res.headers.entries()),
          message: `HTTP error ${res.status}`,
          body: text
        };
      }
      // 正常時
      const data = await res.json();
      // [RESPONSE] ログ出力（status, content-length, Last-Modified）
      if (verbose) {
        const status = res.status;
        const clen = res.headers.get('content-length') || 0;
        const lastModified = res.headers.get('last-modified') || '';
        console.log(`    [RESPONSE] status=${status} content-length=${clen} last-modified=${lastModified}`);
      }
      const ret = {
        lastModified: res.headers.get('last-modified') || undefined,
        data: data
      }
      return ret;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < retries - 1) {
          if (verbose) {
            console.warn(`    [RETRY] timeout for ${url} (${attempt + 1}/${retries}) wait ${backoffMs}ms`);
          }
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw { message: `timeout ${timeoutMs}ms for ${url}`, url };
      }
      if (attempt >= retries - 1) throw err;
      if (verbose) {
        console.warn(`    [RETRY] fetch error for ${url}: ${err.message || err} (${attempt + 1}/${retries}) wait ${backoffMs}ms`);
      }
      await new Promise(r => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw { message: `Failed to fetch ${url} after ${retries} attempts` };
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

export async function fetchDataEntryAsync(targetUrl) {
  const entry = await fetchApiData(targetUrl, false);
  return entry && entry.data !== undefined ? entry.data : null;
}

// data/w3c-*.json を読み込む
export async function loadApiDataAsync(url) { // URL
  try {
    const startedTime = performance.now();

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid protocol');
    }

    const ALLOWED_ORIGINS = [
      location.origin,
      // if necessary, please describe another origin, e.g. https://bar.com", which allows CORS with the Access-Control-Allow-Origin header.
    ];

    if (!ALLOWED_ORIGINS.includes(url.origin)) {
      throw new Error('Origin not allowed');
    }

    const dataResponse = await fetch(url);
    if (!dataResponse.ok) {
      throw new Error(`Failed to load w3c-data.json: ${dataResponse.status}`);
    }
    const mainData = await dataResponse.json();

    // use the name as defaults
    let groupsFilename = "w3c-groups.json";
    let participationsFilename = "w3c-participations.json";
    let affiliationsFilename = "w3c-affiliations.json";
    let usersFilename = "w3c-users.json";
    let specificationsFilename = "w3c-specifications.json";
    let timelineFilename = "w3c-timeline.json";
    // if mainData specified fileType for each files, use it.
    for (const file of mainData.files) {
      const metadata = file._metadata;
      if (metadata.fileType == "groups") {
        groupsFilename = metadata.filename;
      } else if (metadata.fileType == "participations") {
        participationsFilename = metadata.filename;
      } else if (metadata.fileType == "affiliations") {
        affiliationsFilename = metadata.filename;
      } else if (metadata.fileType == "users") {
        usersFilename = metadata.filename;
      } else if (metadata.fileType == "specifications") {
        specificationsFilename = metadata.filename;
      } else if (metadata.fileType == "timeline") {
        timelineFilename = metadata.filename;
      } else {
        console.error("unknown fileType: ", metadata.fileType)
      }
    }

    const baseUrl = url.origin + url.pathname.replace(/[^/]+$/, '');
    const [
      groupsResponse,
      participationsResponse,
      affiliationsResponse,
      usersResponse,
      specificationsResponse,
      timelineResponse
    ] = await Promise.all([
      fetch(new URL(groupsFilename, baseUrl)),
      fetch(new URL(participationsFilename, baseUrl)),
      fetch(new URL(affiliationsFilename, baseUrl)),
      fetch(new URL(usersFilename, baseUrl)),
      fetch(new URL(specificationsFilename, baseUrl)),
      fetch(new URL(timelineFilename, baseUrl)),
    ]);

    if (!groupsResponse.ok) {
      throw new Error(`Failed to load w3c-groups.json: ${groupsResponse.status}`);
    }
    const groupsData = await groupsResponse.json();

    // その他のファイルは必須ではない（まだ存在しない場合がある）
    let participationsData = {};
    if (participationsResponse.ok) {
      participationsData = await participationsResponse.json();
    } else {
      throw new Error(`Failed to load w3c-participations.json: ${participationsResponse.status}`);
    }

    let usersData = {};
    if (usersResponse.ok) {
      usersData = await usersResponse.json();
    } else {
      throw new Error(`Failed to load w3c-users.json: ${usersResponse.status}`);
    }

    let affiliationsData = {};
    if (affiliationsResponse.ok) {
      affiliationsData = await affiliationsResponse.json();
    } else {
      throw new Error(`Failed to load w3c-affiliations.json: ${affiliationsResponse.status}`);
    }

    let specificationsData = {};
    if (specificationsResponse.ok) {
      specificationsData = await specificationsResponse.json();
    } else {
      console.warn(`Warning: no specifications is loaded since it may be an old snapshot data.`);
      // thru
    }
    const apiData = { mainData, groupsData, participationsData, usersData, affiliationsData, specificationsData };

    const endedTime = performance.now();
    console.log(`Data loaded successfully in ${(endedTime - startedTime).toFixed(2)} ms`);

    return apiData;
  } catch (e) {
    throw new Error(`Failed to load api data:` + e);
  }
}
