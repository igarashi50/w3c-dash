// data/w3c-*.json から URL でデータを検索する関数
function findDataByUrl(groupsData, participationsData, usersData, affiliationsData, targetUrl) {
  if (!groupsData || typeof groupsData !== 'object') return null;
  
  // groupsDataから探す
  if (groupsData[targetUrl]?.data) {
    return groupsData[targetUrl].data;
  }
  
  // participationsDataから探す
  if (participationsData && participationsData[targetUrl]?.data) {
    return participationsData[targetUrl].data;
  }
  
  // usersDataから探す
  if (usersData && usersData[targetUrl]?.data) {
    return usersData[targetUrl].data;
  }
  
  // affiliationsDataから探す
  if (affiliationsData && affiliationsData[targetUrl]?.data) {
    return affiliationsData[targetUrl].data;
  }
  
  return null;
}

// data/w3c-*.json を読み込む
async function loadW3CApiData() {
  const [groupsResponse, participationsResponse, usersResponse, affiliationsResponse] = await Promise.all([
    fetch('data/w3c-groups.json'),
    fetch('data/w3c-participations.json'),
    fetch('data/w3c-users.json'),
    fetch('data/w3c-affiliations.json')
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
    console.warn('w3c-participations.json not found');
  }
  
  let usersData = {};
  if (usersResponse.ok) {
    usersData = await usersResponse.json();
  } else {
    console.warn('w3c-users.json not found');
  }
  
  let affiliationsData = {};
  if (affiliationsResponse.ok) {
    affiliationsData = await affiliationsResponse.json();
  } else {
    console.warn('w3c-affiliations.json not found');
  }
  
  return { groupsData, participationsData, usersData, affiliationsData };
}

// WG, IG, CG, TF, Other のグループリストを取得
function extractGroups(apiData) {
  let groups = [];
  const types = ['wg', 'ig', 'cg', 'tf', 'other'];
  const { groupsData, participationsData, usersData, affiliationsData } = apiData;
  
  for (const type of types) {
    const url = `https://api.w3.org/groups/${type}`;
    const data = findDataByUrl(groupsData, participationsData, usersData, affiliationsData, url);
    if (!data) {
      console.warn(`Warning: No data found for URL: ${url}, skipping`);
      continue;
    }
    const urlGroups = data?._links?.groups || [];
    // 各グループにtype情報を追加
    urlGroups.forEach(g => g.groupType = type);
    groups.push(...urlGroups);
  }
  return groups;
}

// グループの participations データを取得
function getParticipationsForGroup(apiData, group) {
  const groupHref = group.href;
  if (!groupHref) return [];
  const { groupsData, participationsData, usersData, affiliationsData } = apiData;
  
  const partHref = groupHref.replace(/\/$/, '') + '/participations';
  const data = findDataByUrl(groupsData, participationsData, usersData, affiliationsData, partHref);
  return data?._links?.participations || [];
}

// グループの users データを取得
function getUsersForGroup(apiData, group) {
  const groupHref = group.href;
  if (!groupHref) return [];
  const { groupsData, participationsData, usersData, affiliationsData } = apiData;
  
  const usersHref = groupHref.replace(/\/$/, '') + '/users';
  const data = findDataByUrl(groupsData, participationsData, usersData, affiliationsData, usersHref);
  return data?._links?.users || [];
}

// participation の詳細データを取得
function getParticipationDetail(apiData, participationHref) {
  const { groupsData, participationsData, usersData, affiliationsData } = apiData;
  return findDataByUrl(groupsData, participationsData, usersData, affiliationsData, participationHref);
}

// グループごとの集計情報を取得
function extractGroupInfo(apiData, group) {
  const name = group.title || group.name || 'Unknown Group';
  const groupType = group.groupType || 'unknown';
  
  // participations を取得
  const participations = getParticipationsForGroup(apiData, group);
  const participantsList = participations.map(p => p.title || p.href || 'Unknown').filter(Boolean);
  
  // users を取得
  const users = getUsersForGroup(apiData, group);
  const usersList = users.map(u => u.title || u.name || u.href || 'Unknown').filter(Boolean);
  
  // invited experts を抽出（participation 詳細から）
  const invited = [];
  const individuals = [];
  const members = [];
  const membersMap = {}; // メンバー組織 -> participants のマッピング
  
  for (const part of participations) {
    const partHref = part.href;
    if (!partHref) continue;
    
    const detail = getParticipationDetail(apiData, partHref);
    if (detail) {
      // user 情報を取得
      const userTitle = detail._links?.user?.title || 'Unknown';
      const orgTitle = detail._links?.organization?.title || part.title || 'Unknown';
      const userHref = detail._links?.user?.href;
      
      if (detail['invited-expert'] === true) {
        invited.push(userTitle);
      } else if (detail['individual'] === true) {
        individuals.push(userTitle);
      } else if (detail['individual'] === false) {
        // individual が false = メンバー組織
        const orgName = orgTitle; // detail._links.organization.title を使用
        members.push(orgName);
        
        // メンバー組織ごとのparticipantsを取得
        if (!membersMap[orgName]) {
          membersMap[orgName] = [];
        }
        
        // /participants エンドポイントからデータを取得
        const participantsHref = detail._links?.participants?.href;
        if (participantsHref) {
          const { groupsData, participationsData, usersData, affiliationsData } = apiData;
          const participantsData = findDataByUrl(groupsData, participationsData, usersData, affiliationsData, participantsHref);
          if (participantsData) {
            const participantItems = participantsData._links?.participants || [];
            for (const pItem of participantItems) {
              // pItemには既にユーザー情報が含まれている
              if (pItem.href && pItem.title) {
                membersMap[orgName].push({
                  name: pItem.title,
                  userHref: pItem.href
                });
              }
            }
          }
        }
      }
    }
  }
  
  const uniqInvited = Array.from(new Set(invited));
  const uniqIndividuals = Array.from(new Set(individuals));
  const uniqMembers = Array.from(new Set(members));
  
  // Members = Participations - Invited Experts - Individuals
  const membersCount = uniqMembers.length;
  // Participants = Users + Invited Experts + Individuals
  const totalParticipantsCount = usersList.length + uniqInvited.length + uniqIndividuals.length;
  // Participants のリスト (Users + Invited Experts + Individuals)
  const totalParticipantsList = [...usersList, ...uniqInvited, ...uniqIndividuals];
  
  return {
    name,
    groupType,
    participantsCount: participantsList.length,
    participantsList: uniqMembers,
    membersMap, // メンバー組織 -> participants のマッピング
    usersCount: usersList.length,
    usersList,
    invitedCount: uniqInvited.length,
    invited: uniqInvited,
    individualsCount: uniqIndividuals.length,
    individuals: uniqIndividuals,
    membersCount,
    totalParticipantsCount,
    totalParticipantsList
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
        groupType: group.groupType || 'unknown',
        participantsCount: 0,
        participantsList: [],
        membersMap: {},
        usersCount: 0,
        usersList: [],
        invitedCount: 0,
        invited: [],
        individualsCount: 0,
        individuals: [],
        membersCount: 0,
        totalParticipantsCount: 0,
        totalParticipantsList: [],
        _error: e.message || String(e)
      };
    }
  }).sort((a, b) => (b.invitedCount || 0) - (a.invitedCount || 0));
}