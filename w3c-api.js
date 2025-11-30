// data/w3c-groups.json から URL でデータを検索する関数
function findDataByUrl(apiData, targetUrl) {
  if (!apiData || typeof apiData !== 'object') return null;
  return apiData[targetUrl]?.data || null;
}

// data/w3c-groups.json を読み込む
async function loadW3CApiData() {
  const response = await fetch('data/w3c-groups.json');
  if (!response.ok) {
    throw new Error(`Failed to load w3c-groups.json: ${response.status}`);
  }
  return response.json();
}

// WG, IG, CG, TF, Other のグループリストを取得
function extractGroups(apiData) {
  let groups = [];
  const types = ['wg', 'ig', 'cg', 'tf', 'other'];
  
  for (const type of types) {
    const url = `https://api.w3.org/groups/${type}`;
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
  const data = findDataByUrl(apiData, partHref);
  return data?._links?.participations || [];
}

// グループの users データを取得
function getUsersForGroup(apiData, group) {
  const groupHref = group.href;
  if (!groupHref) return [];
  
  const usersHref = groupHref.replace(/\/$/, '') + '/users';
  const data = findDataByUrl(apiData, usersHref);
  return data?._links?.users || [];
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