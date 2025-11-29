// data/w3c_api.json から URL でデータを検索する関数
function findDataByUrl(apiData, targetUrl) {
  if (!Array.isArray(apiData)) return null;
  const record = apiData.find(r => r.url === targetUrl);
  return record ? record.data : null;
}

// data/w3c_api.json を読み込む
async function loadW3CApiData() {
  const response = await fetch('../data/w3c_api.json');
  if (!response.ok) {
    throw new Error(`Failed to load w3c_api.json: ${response.status}`);
  }
  return response.json();
}

// WG と IG のグループリストを取得
function extractGroups(apiData) {
  let groups = [];
  const urls = [
    'https://api.w3.org/groups/wg',
    'https://api.w3.org/groups/ig'
  ];
  for (const url of urls) {
    const data = findDataByUrl(apiData, url);
    if (!data) {
      console.warn(`Warning: No data found for URL: ${url}, skipping`);
      continue;
    }
    const urlGroups = data?._links?.groups || [];
    groups.push(...urlGroups);
  }
  return groups;
}

// グループの participations データを取得
function getParticipationsForGroup(apiData, group) {
  const groupHref = group.href;
  if (!groupHref) return [];
  
  const partHref = groupHref.replace(/\/$/, '') + '/participations';
  const participations = [];
  
  // participations のページデータを探す（ページネーション対応）
  for (const record of apiData) {
    if (record.url && record.url.startsWith(partHref)) {
      const pageData = record.data;
      if (pageData?._links?.participations) {
        participations.push(...pageData._links.participations);
      }
    }
  }
  
  return participations;
}

// グループの users データを取得
function getUsersForGroup(apiData, group) {
  const groupHref = group.href;
  if (!groupHref) return [];
  
  const usersHref = groupHref.replace(/\/$/, '') + '/users';
  const users = [];
  
  // users のページデータを探す（ページネーション対応）
  for (const record of apiData) {
    if (record.url && record.url.startsWith(usersHref)) {
      const pageData = record.data;
      if (pageData?._links?.users) {
        users.push(...pageData._links.users);
      }
    }
  }
  
  return users;
}

// participation の詳細データを取得
function getParticipationDetail(apiData, participationHref) {
  return findDataByUrl(apiData, participationHref);
}

// グループごとの集計情報を取得
function extractGroupInfo(apiData, group) {
  const name = group.title || group.name || 'Unknown Group';
  
  // participations を取得
  const participations = getParticipationsForGroup(apiData, group);
  const participantsList = participations.map(p => p.title || p.href || 'Unknown').filter(Boolean);
  
  // users を取得
  const users = getUsersForGroup(apiData, group);
  const usersList = users.map(u => u.title || u.name || u.href || 'Unknown').filter(Boolean);
  
  // invited experts を抽出（participation 詳細から）
  const invited = [];
  for (const part of participations) {
    const partHref = part.href;
    if (!partHref) continue;
    
    const detail = getParticipationDetail(apiData, partHref);
    if (detail && detail['invited-expert'] === true) {
      // user 情報を取得
      const userName = detail._links?.user?.title || 
                      detail._links?.organization?.title || 
                      part.title || 
                      'Unknown';
      invited.push(userName);
    }
  }
  
  const uniqInvited = Array.from(new Set(invited));
  
  return {
    name,
    participantsCount: participantsList.length,
    participantsList,
    usersCount: usersList.length,
    usersList,
    invitedCount: uniqInvited.length,
    invited: uniqInvited
  };
}

// すべてのグループ情報を取得（メイン関数）
async function getAllGroupsInfo() {
  const apiData = await loadW3CApiData();
  const groups = extractGroups(apiData);
  
  return groups.map(group => {
    try {
      return extractGroupInfo(apiData, group);
    } catch (e) {
      return {
        name: group.title || 'Unknown',
        participantsCount: 0,
        participantsList: [],
        usersCount: 0,
        usersList: [],
        invitedCount: 0,
        invited: [],
        _error: e.message || String(e)
      };
    }
  }).sort((a, b) => (b.invitedCount || 0) - (a.invitedCount || 0));
}