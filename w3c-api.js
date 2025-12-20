class GroupInfo {
  constructor({
    name = 'Unknown',
    groupType = 'unknown',
    membersMap = {},
    memberParticipants = [],
    invitedExperts = [],
    individuals = [],
    staffs = [],
    allParticipants = [],
    isException = false,
    homepage = '',
    _error = undefined
  } = {}) {
    this.name = name;
    this.groupType = groupType;
    this.membersMap = membersMap;
    this.memberParticipants = memberParticipants;
    this.invitedExperts = invitedExperts;
    this.individuals = individuals;
    this.staffs = staffs;
    this.allParticipants = allParticipants;
    this.isException = isException;
    this.homepage = homepage;
    this._error = _error;
  }
}

// グローバルapiDataを参照し、URLでデータを検索する関数
let globalApiData = null;

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

async function fetchJson(url, retries = 6, backoffMs = 60000, timeoutMs = 180000, verbose=false) {
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
        const clen = res.headers.get('content-length')|| 0;
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

async function fetchDataAsync(targetUrl) { 
  const entry =  await fetchApiData(targetUrl, false);
  return entry && entry.data !== undefined ? entry.data : null;
}

function getData(targetUrl) {
  try {
    if (!globalApiData) {
      console.warn('globalApiData is not loaded');
      return null;
    }
    let entry = null;
    if (targetUrl.startsWith('https://api.w3.org/groups/')) {
      entry = globalApiData.groupsData[targetUrl];
    } else if (targetUrl.startsWith('https://api.w3.org/participations/')) {
      entry = globalApiData.participationsData[targetUrl];
    } else if (targetUrl.startsWith('https://api.w3.org/users/')) {
      entry = globalApiData.usersData[targetUrl];
    } else if (targetUrl.startsWith('https://api.w3.org/affiliations/')) {
      entry = globalApiData.affiliationsData[targetUrl];
    } else {
      console.warn(`error: No such data categoly: ${targetUrl}`);
      return null;
    }
    if (!entry) {
      // for DEBUG console.warn(`warning: No entry found for URL ${targetUrl}`);
      return null;
    }
    if (!entry.data) {
      console.warn(`warning: Entry has no data for URL ${targetUrl}`);
      return null;
    }
    let data = entry.data;
    if (data._error) {
      console.warn(`error: data for URL ${targetUrl} has error: ${data._error}`);
      return null;
    }
    return data;
  } catch (e) {
    console.error(`Exception in getData for URL ${targetUrl}: ${String(e)}`);
    return null;
  }
}

// data/w3c-*.json を読み込む
async function loadData() {
  const startedTime = performance.now();
  const [dataResponse, groupsResponse, participationsResponse, usersResponse, affiliationsResponse] = await Promise.all([
    fetch('data/w3c-data.json'),
    fetch('data/w3c-groups.json'),
    fetch('data/w3c-participations.json'),
    fetch('data/w3c-users.json'),
    fetch('data/w3c-affiliations.json')
  ]);

  if (!dataResponse.ok) {
    throw new Error(`Failed to load w3c-data.json: ${dataResponse.status}`);
  }
  const mainData = await dataResponse.json();

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
  // set setApiData
  globalApiData = { mainData, groupsData, participationsData, usersData, affiliationsData };
  window.getData = getData;

  const endedTime = performance.now();
  console.log(`Data loaded successfully in ${(endedTime - startedTime).toFixed(2)} ms`);
}

// WG, IG, CG, TF, Other のグループリストを取得
function extractGroups() {
  let groups = [];
  const types = ['wg', 'ig', 'cg', 'tf', 'other'];

  for (const type of types) {
    const url = `https://api.w3.org/groups/${type}`;
    const data = getData(url);
    if (!data) {
      console.warn(`Warning: No data found for URL: ${url}, skipping`);
      continue;
    }
    let urlGroups = data._links?.groups || [];
    // オブジェクトの場合は配列化
    if (urlGroups && typeof urlGroups === 'object' && !Array.isArray(urlGroups)) {
      urlGroups = Object.values(urlGroups);
    }
    // 各グループにtype情報を追加
    urlGroups.forEach(g => g.groupType = type);
    groups.push(...urlGroups);
  }
  return groups;
}

// groupを引数に、participationsから各種Mapを返す
function getParticipationsClassificationMaps(groupType, participationsUrl) {
  const membersMap = new Map();
  const memberParticipantsMap = new Map(); // userHref -> userObj
  const individualsMap = new Map(); // userHref -> userObj  
  const invitedExpertsMap = new Map();
  const staffsMap = new Map();
  // groupDetailは呼び出し元で取得済み
  // orgは不要

  if (participationsUrl) {
    try {
      const participationsData = getData(participationsUrl);
      let participationsArray = participationsData?._links?.participations || [];
      if (participationsArray && typeof participationsArray === 'object' && !Array.isArray(participationsArray)) {
        participationsArray = Object.values(participationsArray);
      }
      if (Array.isArray(participationsArray) && participationsArray.length > 0) {
        for (const part of participationsArray) {
          try {
            let isMember = false;
            const partDetail = getData(part.href);
            // Members: individual=false, invited-expert=false
            if (partDetail['individual'] === false) {
              const orgTitle = partDetail._links?.organization?.title || part.title || 'Unknown';
              const affiliationHref = partDetail._links?.organization?.href;
              if (affiliationHref) {
                const affData = getData(affiliationHref);
                if (affData) {
                  isMember = affData['is-member']
                  if (!isMember) {
                    if (groupType === 'wg' || groupType === 'ig') {
                      // WG/IGの場合、メンバーシップであるはずなので警告を出す
                      console.log(`Warning: ${orgTitle} in ${groupType}: ${org} is a not W3C member's organization, skipping as member`);
                      continue
                    } else if (groupType === 'cg' || groupType === 'tf' || groupType === 'other') {
                      // CG/TF/Otherの場合、メンバーシップでない場合もあるので警告は出さない
                      // console.log(`  [Info] ${orgTitle} in q${groupType}: ${org} is a not W3C member's organization, skipping as member`);
                    }
                  }
                } else {
                  console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${orgTitle}`);
                  ccontinue;
                }
              } else {
                console.warn(`Warning: Participation ${part.href} of ${org} has no organization href`);
                continue;
              }
              const participantsHref = partDetail._links?.participants?.href;
              if (participantsHref) {
                const participantsData = getData(participantsHref);  // // participatonsの場合はaffiliationsは一つだけ
                let participantItems = participantsData?._links?.participants || [];
                if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
                  participantItems = Object.values(participantItems);
                }
                const participantsArray = [];
                for (const pItem of participantItems) {
                  if (pItem.href && pItem.title) {
                    // usersMap: userHref -> userObj
                    const participant = makeParticipant(pItem.href, pItem.title);
                    participantsArray.push(participant);
                  }
                }
                if (isMember) {
                  addParticipantsArrayToMembersMap(orgTitle, participantsArray, membersMap); // 会員なのでMemberとして追加
                  addParticipantsArrayToMap(participantsArray, memberParticipantsMap);
                } else {
                  addParticipantsArrayToMap(participantsArray, individualsMap);
                }
              }
            } else if (partDetail['individual'] === true) { // Invited Experts: individual=true, invited-expert=true
              const userHref = partDetail._links?.user?.href;
              const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
              const participant = makeParticipant(userHref, userTitle);
              if (partDetail['invited-expert'] === true) {
                addParticipantToMap(participant, invitedExpertsMap);
              } else {        // Indivisuals or Staffs: individual=true, invited-expert=false
                if (userHref) {
                  const userData = getData(userHref);
                  const afflicationsHref = userData?._links?.affiliations?.href;
                  const affName = userData?._links?.affiliations?.title || 'Unknown';
                  if (!afflicationsHref) {
                    // console.warn(`Warning: Participation ${part.href} of ${userTitle} has no organization href`);
                    continue; // 個人参加の場合は組織がないこともあるので警告は出さない
                  }
                  const { isW3CStaff, isInviedExpert, isMember, afflications } = checkAffiliations(afflicationsHref);
                  if (isW3CStaff) {
                    addParticipantToMap(participant, staffsMap);
                  } else if (isMember) {
                    if (groupType == 'working group' || groupType == 'interest group') {
                      console.log(`  Warning: User "${userTitle}" in group "${groupType}" is classified as Individual without W3C staff affiliation`);
                    } else {
                      addParticipantToMembersMap(affName, participant, membersMap);
                      addParticipantToMap(participant, memberParticipantsMap);
                    }
                  } else {
                    addParticipantToMap(participant, individualsMap);
                  }
                }
              }
            }
          } catch (e) {
            console.error(`Exception in processing participations for URL ${participationsUrl}: ${String(e)}`);
          }
        }
      }
    } catch (e) {
      console.error(`Exception in getParticipationsClassificationMaps for URL ${participationsUrl}: ${String(e)}`);
    }
    return { membersMap, memberParticipantsMap, individualsMap, invitedExpertsMap, staffsMap };
  }
}

function checkAffiliations(affiliationsHref) {
  let isMember = false;
  let isW3CStaff = false;
  let isInvitedExpert = false;
  let afflications = [];

  try {
    const affiliationsEntry = getData(affiliationsHref);
    let affs = affiliationsEntry?._links?.affiliations;
    // affsがundefined/nullなら空配列、配列でなければObject.valuesで配列化
    if (!affs) {
      affs = [];
    } else if (!Array.isArray(affs)) {
      affs = Object.values(affs);
    }
    for (const aff of affs) {
      const affiliationHref = aff.href;
      if (!affiliationHref) {
        console.warn(`Warning: User ${userTitle}'s affiliation ${aff} has no affiliation href`);
        continue;
      }
      const affData = getData(affiliationHref);
      if (!affData) {
        console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${userTitle}`);
        continue;
      }
      afflications.push(aff);
      if (affData.name === 'W3C') {
        isW3CStaff = true;
      } else {
        if (affData['is-member'] === true) {
          isMember = true;
        }
      }
    }
  } catch (e) {
    console.error(`Exception in checkAffiliations for URL ${affiliationsHref}: ${String(e)}`);
  }
  return { isMember, isW3CStaff, isInvitedExpert, afflications };
}

// urersUrlからusers情報を読み各種Mapを返す
function getUsersClassificationMaps(groupType, usersUrl) {
  const membersMap = new Map(); // orgUrl -> orgData
  const memberParticipantsMap = new Map(); // orgUrl -> userObj
  const individualsMap = new Map(); // userHref -> userObj
  const invitedExpertsMap = new Map(); // userHref -> userObj
  const staffsMap = new Map(); // userHref -> userObj

  let usersMap = new Map();
  try {
    const usersData = getData(usersUrl);
    const usersArray = usersData?._links?.users || [];
    if (Array.isArray(usersArray) && usersArray.length > 0) {
      usersMap = new Map(usersArray.map(u => [u.href, u]));
    }
    // usersArrayが空配列やundefinedの場合は空のMapのまま
  } catch (e) {
    console.error(`Exception in getUsersMap for URL ${usersUrl}: ${String(e)}`);
  }
  for (const user of usersMap.values()) {
    try {
      const userHref = user.href;
      const userDetails = getData(userHref);
      const userTitle = user.title || 'Unknown';
      const affiliationsHref = userDetails?._links?.affiliations?.href;
      const participant = makeParticipant(userHref, userTitle);
      if (affiliationsHref) {
        let { isMember, isW3CStaff, isInvitedExpert, afflications } = checkAffiliations(affiliationsHref);
        if (isMember) {
          if (afflications.length != 1) {
            console.log(`  Warning: User "${user.title}" has multiple affiliations, skip saving as member participant`);
          } else {
            const orgTitle = afflications[0].title || 'Unknown';
            // 複数のusersが同じ組織に所属している場合を考慮
            addParticipantToMembersMap(orgTitle, participant, membersMap);
            addParticipantToMap(participant, memberParticipantsMap);
          }
        } else if (isInvitedExpert) {
          if (groupType === 'working group' || groupType === 'interest group') {
            console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Invited Expert without W3C staff affiliation`);
          } else {
            addParticipantToMap(participant, invitedExpertsMap);
          }
        } else if (isW3CStaff) {
          addParticipantToMap(participant, staffsMap);
        } else {
          if (groupType === 'working group') {
            console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Individual without W3C staff affiliation`);
          } else {
            addParticipantToMap(participant, individualsMap);
          }
        }
      }
    } catch (e) {
      console.error(`Exception in processing user ${user.href}: ${String(e)}`);
    }
  }
  return { membersMap, memberParticipantsMap, individualsMap, invitedExpertsMap, staffsMap };
}

// グループごとの集計情報を取得
function extractGroupInfo(group) {
  const name = group.title || group.name || 'Unknown Group';
  const groupType = group.groupType || 'unknown';
  // グループ詳細
  const groupDetail = getData(group.href);
  const homepage = groupDetail?._links?.homepage?.href;


  let isIndivisualParticipationGroup = false;
  const participationsUrl = groupDetail?._links?.participations?.href;
  const usersUrl = groupDetail?._links?.users?.href;
  let membersMap = new Map();
  let memberParticipantsMap = new Map();
  let individualsMap = new Map();
  let invitedExpertsMap = new Map();
  let staffsMap = new Map();

  if (participationsUrl) {
    ({
      membersMap,
      memberParticipantsMap,
      individualsMap,
      invitedExpertsMap,
      staffsMap
    } = getParticipationsClassificationMaps(groupType, participationsUrl));
  } else if (usersUrl) {
    isIndivisualParticipationGroup = true;
    ({
      membersMap,
      memberParticipantsMap,
      individualsMap,
      invitedExpertsMap,
      staffsMap
    } = getUsersClassificationMaps(groupType, usersUrl));
  }

  // Participants = memberParticipants + Invited Experts + Individuals + Staffs（重複許容）
  const allParticipantsArray = [
    ...Array.from(membersMap.values()).flat(),
    ...invitedExpertsMap.values(),
    ...staffsMap.values(),
    ...individualsMap.values(),
  ];

  const groupInfo = new GroupInfo({
    name,
    groupType,
    membersMap: membersMap,
    memberParticipants: memberParticipantsMap.size > 0 ? Array.from(memberParticipantsMap.values()) : [],
    invitedExperts: invitedExpertsMap.size > 0 ? Array.from(invitedExpertsMap.values()) : [],
    individuals: individualsMap.size > 0 ? Array.from(individualsMap.values()) : [],
    staffs: staffsMap.size > 0 ? Array.from(staffsMap.values()) : [],
    allParticipants: allParticipantsArray,
    isException: isIndivisualParticipationGroup,  // some IGs, task forces and other groups, e.g. ab.
    homepage
  });
  return groupInfo;
}


function createSummaryGroup() {
  const allMembersMap = new Map();
  const allMemberParticipantsMap = new Map();
  const allInvitedExpertsMap = new Map();
  const allStaffsMap = new Map();
  const allIndividualsMap = new Map();
  const allParticipantsMap = new Map()

  const allAffEntry = getData('https://api.w3.org/affiliations/');
  if (!allAffEntry || allAffEntry.length === 0) {
    return undefined
  }

  const afflications = allAffEntry._links?.affiliations || [];
  for (const affEntry of afflications) {
    const participantsArray = [];
    const affData = getData(affEntry.href);
    const affName = affData?.name || 'Unknown';
    if (affData) {
      const participantsHref = affData._links?.participants?.href;
      if (participantsHref) {
        const participantsData = getData(participantsHref);  // // participatonsの場合はaffiliationsは一つだけ
        let participantItems = participantsData?._links?.participants || [];
        if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
          participantItems = Object.values(participantItems);
        }
        for (const pItem of participantItems) {
          if (pItem.href && pItem.title) {
            participantsArray.push(makeParticipant(pItem.href, pItem.title));
          }
        }
      }
    }
    if (affData['is-member'] == true) {
      addParticipantsArrayToMembersMap(affName, participantsArray, allMembersMap);
      addParticipantsArrayToMap(participantsArray, allMemberParticipantsMap);
    } else if (affData.name == 'W3C') {
      addParticipantsArrayToMap(participantsArray, allStaffsMap);
    } else if (affData.name == 'W3C Invited Experts') {
      addParticipantsArrayToMap(participantsArray, allInvitedExpertsMap);
    } else {
      addParticipantsArrayToMap(participantsArray, allIndividualsMap);
    }
    // 全参加者Mapにも追加
    addParticipantsArrayToMap(participantsArray, allParticipantsMap);
  }

  // IEの場合は、自分でaffiliationを持つ場合があるので、Individualsから重複を削除する
  let overlapInvitedExpertsCount = 0;
  for (const [userHref, participant] of allInvitedExpertsMap.entries()) {
    if (allIndividualsMap.has(userHref)) {
      // console.log(`  Info: Removing Invited experts from Individuals : ${participant.name}, ${userHref}`);
      allIndividualsMap.delete(userHref);
      overlapInvitedExpertsCount++;
    }
  }
  if (overlapInvitedExpertsCount > 0) {
    console.log(`  Info: Removed ${overlapInvitedExpertsCount} overlapping Invited Experts from Individuals`);
  }
  // 重複チェック
  checkOverlapParticipants(allParticipantsMap, allMemberParticipantsMap, allInvitedExpertsMap, allStaffsMap, allIndividualsMap);

  const groupInfo = new GroupInfo({
    name: 'Summary',
    groupType: 'summary',
    membersMap: allMembersMap,
    memberParticipants: allMemberParticipantsMap.size > 0 ? Array.from(allMemberParticipantsMap.values()) : [],
    invitedExperts: allInvitedExpertsMap.size > 0 ? Array.from(allInvitedExpertsMap.values()) : [],
    individuals: allIndividualsMap.size > 0 ? Array.from(allIndividualsMap.values()) : [],
    staffs: allStaffsMap.size > 0 ? Array.from(allStaffsMap.values()) : [],
    allParticipants: allParticipantsMap.size > 0 ? Array.from(allParticipantsMap.values()) : [],
    isException: false,  // some IGs, task forces and other groups, e.g. ab.
    homepage: undefined
  });
  return groupInfo;
}

function checkOverlapParticipants(allParticipantsMap, allMemberParticipantsMap, allInvitedExpertsMap, allStaffsMap, allIndividualsMap) {
  const allParticipantsCount = allMemberParticipantsMap.size + allInvitedExpertsMap.size + allStaffsMap.size + allIndividualsMap.size
  console.log(`  Info: Summary allParticipantsCount=${allParticipantsCount}, allParticipantsMap.size=${allParticipantsMap.size}`);
  if (allParticipantsCount !== allParticipantsMap.size) {
    console.log(`  Error: Summary count mismatch! allParticipantsCount=${allParticipantsCount}, allParticipantsMap.size=${allParticipantsMap.size}`);
    const mergedMap = new Map([
      ...allMemberParticipantsMap.entries(),
      ...allInvitedExpertsMap.entries(),
      ...allStaffsMap.entries(),
      ...allIndividualsMap.entries()
    ]);
    console.log(`  Error: Summary mergedMap.size=${mergedMap.size}`);
    const maps = [allMemberParticipantsMap, allInvitedExpertsMap, allStaffsMap, allIndividualsMap];
    for (let i = 0; i < maps.length; i++) {
      for (let j = i + 1; j < maps.length; j++) {
        console.log(`  Info: Checking overlap between maps #${i} and #${j}`);
        const mapA = maps[i];
        const mapB = maps[j];
        const diff = new Map();
        for (const [key, value] of mapA.entries()) {
          if (mapB.has(key)) {
            diff.set(key, value);
          }
        }
        if (diff.size > 0) {
          console.log(`  Error: Overlap found between maps #${i} and #${j}: size=${diff.size}`);
          for (const [key, value] of diff.entries()) {
            console.log(`    Overlap name: ${value.name}, userHref: ${value.userHref}`);
          }
        }
      }
    }
  }
}


function makeParticipant(userHref, name) {
  let numGroups = 0
  const userData = getData(userHref);
  if (userData) {
    const groupsHref = userData?._links?.groups?.href;
    if (groupsHref) {
      const groupsData = getData(groupsHref);
      let groupsArray = groupsData?._links?.groups || [];
      if (Array.isArray(groupsArray)) {
        numGroups = Object.values(groupsArray).length;
      }
    }
  }
  return { userHref: userHref, name: name, numGroups: numGroups };
}

function addParticipantsArrayToMap(participantsArray, map) {
  if (!Array.isArray(participantsArray)) {
    console.error(`addParticipantsArrayToMap: participantsArray is not an array`);
    return;
  }
  participantsArray.forEach(participant => {
    addParticipantToMap(participant, map);
  });
}

function addParticipantToMap(participant, map) {
  map.set(participant.userHref, participant);
}

function addParticipantsArrayToMembersMap(orgName, participantsArray, membersMap) {
  if (!Array.isArray(participantsArray)) {
    console.error(`addParticipantsArrayToMembersMap: participantsArray is not an array for orgName=${orgName}`);
    return;
  }
  for (const participant of participantsArray) {
    addParticipantToMembersMap(orgName, participant, membersMap);
  }
}

function addParticipantToMembersMap(orgName, participant, map) {
  // mapの値は必ず配列である前提で、orgUrlごとにparticipantを重複なく追加
  if (!map.has(orgName)) {
    map.set(orgName, [participant]);
  } else {
    const arr = map.get(orgName);
    if (!arr.some(p => p.userHref === participant.userHref)) {
      arr.push(participant);
    }
  }
}

function createSummaryGroupFromGroups(groups) {
  // 全体統計を計算（重複を除く）
  const allMembers = new Map();
  const allMemberParticipants = new Map();
  const allInvitedExperts = new Map();
  const allStaffs = new Map();
  const allIndividuals = new Map();
  const allParticipants = new Map()

  groups.forEach(group => {
    // Members
    if (group.membersMap) {
      for (const [orgName, participants] of group.membersMap instanceof Map ? group.membersMap.entries() : Object.entries(group.membersMap)) {
        for (const participant of participants) {
          addParticipantToMembersMap(orgName, participant, allMembers);
        }
      }
    }
    if (group.memberParticipants) addParticipantsArrayToMap(group.memberParticipants, allMemberParticipants);
    if (group.invitedExperts) addParticipantsArrayToMap(group.invitedExperts, allInvitedExperts);
    if (group.staffs) addParticipantsArrayToMap(group.staffs, allStaffs);
    if (group.individuals) addParticipantsArrayToMap(group.individuals, allIndividuals);
    if (group.allParticipants) addParticipantsArrayToMap(group.allParticipants, allParticipants);
  });

  const groupInfos = new GroupInfo({
    name: 'Summary',
    groupType: 'summary',
    membersMap: allMembers,
    memberParticipants: allMemberParticipants.size > 0 ? Array.from(allMemberParticipants.values()) : [],
    invitedExperts: allInvitedExperts.size > 0 ? Array.from(allInvitedExperts.values()) : [],
    individuals: allIndividuals.size > 0 ? Array.from(allIndividuals.values()) : [],
    staffs: allStaffs.size > 0 ? Array.from(allStaffs.values()) : [],
    allParticipants: allParticipants.size > 0 ? Array.from(allParticipants.values()) : [],
    isException: false,  // some IGs, task forces and other groups, e.g. ab.
    homepage: undefined
  });
  return groupInfos;
}

// すべてのグループ情報を取得（メイン関数）
async function getAllGroupsInfo() {
  await loadData();
  const groups = extractGroups();


  const groupsArray = groups.map(group => extractGroupInfo(group))

  let isOnlyGroupParticipations = false;

  let summaryGroup = createSummaryGroup()
  let onlyGroupParticipationsSummaryGroup = createSummaryGroupFromGroups(groupsArray)
  if (!summaryGroup) {
    summaryGroup = onlyGroupParticipationsSummaryGroup;
    onlyGroupParticipationsSummaryGroup = undefined;
    isOnlyGroupParticipations = true;
  }

  const groupsInfo = {
    groupsArray,
    summaryGroup,
    onlyGroupParticipationsSummaryGroup,
    isOnlyGroupParticipations,
    lastChecked: globalApiData.mainData._metadata.lastChecked
  };
  return groupsInfo;
}
