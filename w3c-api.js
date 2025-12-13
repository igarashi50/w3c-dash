// ES6 GroupInfoクラス定義
class GroupInfo {
  constructor({
    name = 'Unknown',
    groupType = 'unknown',
    membersCount = 0,
    membersMap = {},
    memberParticipantsCount = 0,
    memberParticipants = [],
    invitedExpertsCount = 0,
    invitedExperts = [],
    individualsCount = 0,
    individuals = [],
    staffsCount = 0,
    staffs = [],
    allParticipantsCount = 0,
    allParticipants = [],
    isException = false,
    homepage = '',
    _error = undefined
  } = {}) {
    this.name = name;
    this.groupType = groupType;
    this.membersCount = membersCount;
    this.membersMap = membersMap;
    this.memberParticipantsCount = memberParticipantsCount;
    this.memberParticipants = memberParticipants;
    this.invitedExpertsCount = invitedExpertsCount;
    this.invitedExperts = invitedExperts;
    this.individualsCount = individualsCount;
    this.individuals = individuals;
    this.staffsCount = staffsCount;
    this.staffs = staffs;
    this.allParticipantsCount = allParticipantsCount;
    this.allParticipants = allParticipants;
    this.isException = isException;
    this.homepage = homepage;
    this._error = _error;
  }
}
// グローバルapiDataを参照し、URLでデータを検索する関数
let globalApiData = null;
function findByDataUrl(targetUrl) {
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
      console.warn(`warning: No entry found for URL ${targetUrl}`);
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
    console.error(`Exception in findByDataUrl for URL ${targetUrl}: ${String(e)}`);
    return null;
  }
}

// data/w3c-*.json を読み込む
async function loadData() {
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
  globalApiData = { groupsData, participationsData, usersData, affiliationsData };
  window.findByDataUrl = findByDataUrl;
}

// WG, IG, CG, TF, Other のグループリストを取得
function extractGroups() {
  let groups = [];
  const types = ['wg', 'ig', 'cg', 'tf', 'other'];

  for (const type of types) {
    const url = `https://api.w3.org/groups/${type}`;
    const data = findByDataUrl(url);
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
function getParticipationsClassificationMaps(groupDetail) {
  const membersFromParticipationsMap = new Map();
  const usersFromParticipationsMap = new Map(); // userHref -> userObj
  const individualsFromParticipationsMap = new Map(); // userHref -> userObj  
  const invitedExpertsFromParticipationsMap = new Map();
  const staffsFromParticipationsMap = new Map();
  const participationsUrl = groupDetail?._links?.participations?.href;
  if (participationsUrl) {
    try {
      const participationsData = findByDataUrl(participationsUrl);
      let participationsArray = participationsData?._links?.participations || [];
      if (participationsArray && typeof participationsArray === 'object' && !Array.isArray(participationsArray)) {
        participationsArray = Object.values(participationsArray);
      }
      if (Array.isArray(participationsArray) && participationsArray.length > 0) {
        for (const part of participationsArray) {
          try {
            const partDetail = findByDataUrl(part.href);
            // Members: individual=false, invited-expert=false
            if (partDetail['individual'] === false && partDetail['invited-expert'] === false) {
              const orgTitle = partDetail._links?.organization?.title || part.title || 'Unknown';
              if (!membersFromParticipationsMap.has(orgTitle)) membersFromParticipationsMap.set(orgTitle, []);
              // participantsエンドポイントから個人を取得
              const participantsHref = partDetail._links?.participants?.href;
              if (participantsHref) {
                const participantsData = findByDataUrl(participantsHref);
                let participantItems = participantsData?._links?.participants || [];
                if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
                  participantItems = Object.values(participantItems);
                }
                for (const pItem of participantItems) {
                  if (pItem.href && pItem.title) {
                    // usersFromParticipationsMap: userHref -> userObj
                    usersFromParticipationsMap.set(pItem.href, { name: pItem.title, userHref: pItem.href });
                    // membersMap: orgTitle -> [{name, userHref}]
                    if (!membersFromParticipationsMap.get(orgTitle).some(u => u.userHref === pItem.href)) {
                      membersFromParticipationsMap.get(orgTitle).push({ name: pItem.title, userHref: pItem.href });
                    }
                  }
                }
              }
            }
            // Invited Experts: individual=true, invited-expert=true
            else if (partDetail['individual'] === true && partDetail['invited-expert'] === true) {
              const userHref = partDetail._links?.user?.href;
              const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
              if (userHref) invitedExpertsFromParticipationsMap.set(userHref, { name: userTitle, userHref });
            }
            // Staffs: individual=true, invited-expert=false
            else if (partDetail['individual'] === true && partDetail['invited-expert'] === false) {
              const userHref = partDetail._links?.user?.href;
              const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
              let isW3CStaff = false;
              if (userHref) {
                const affiliationsHref = userHref + '/affiliations';
                const affiliationsEntry = findByDataUrl(affiliationsHref);
                if (affiliationsEntry?._links?.affiliations) {
                  let affs = affiliationsEntry._links.affiliations;
                  if (affs == undefined) {
                    console.log(`  [Debug] User "${userTitle}": EMPTY affiliations`);
                  } else {
                    if (!Array.isArray(affs)) affs = Object.values(affs);
                    isW3CStaff = affs.some(aff => aff.title === 'W3C');
                  }
                }
                if (isW3CStaff) {
                  staffsFromParticipationsMap.set(userHref, { name: userTitle, userHref });
                } else if (groupDetail.type == 'wg' || groupDetail.type == 'ig') {
                  console.log(`  Warning: User "${userTitle}" in group "${groupDetail.name || 'Unknown'}" is classified as Individual without W3C staff affiliation`);
                } else {
                  individualsFromParticipationsMap.set(userHref, { name: userTitle, userHref });
                }
              }
            }
          } catch (e) {
            console.error(`Exception in processing participation ${part.href}: ${String(e)}`);
          }
        }
      }
    } catch (e) {
      console.error(`Exception in processing participations for URL ${participationsUrl}: ${String(e)}`);
    }
  }
  return { membersFromParticipationsMap, usersFromParticipationsMap, individualsFromParticipationsMap, invitedExpertsFromParticipationsMap, staffsFromParticipationsMap };
}


// groupDetailを引数に、usersMapからindivisualMembersMap, indivisualsMap, invitedExpertsMap, staffMapを返す
function getUsersClassificationMaps(groupDetail) {
  const membersFromUsersMap = new Map(); // orgUrl -> orgData
  const individualsFromUsersMap = new Map(); // userHref -> userObj
  const invitedExpertsFromUsersMap = new Map(); // userHref -> userObj
  const staffsFromUsersMap = new Map(); // userHref -> userObj
  let usersMap = new Map();

  const usersUrl = groupDetail?._links?.users?.href;
  if (usersUrl) {
    try {
        const usersData = findByDataUrl(usersUrl);
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
        let isW3CStaff = false;
        let isInvitedExpert = false;
        const userDetail = findByDataUrl(userHref);
        const affiliationsHref = userDetail?._liks?.affiliations?.href;
        let orgAffiliations = [];
        if (affiliationsHref) {
          const affiliationsEntry = findByDataUrl(affiliationsHref);
          if (affiliationsEntry && affiliationsEntry._links && affiliationsEntry._links.affiliations) {
            let affs = affiliationsEntry._links.affiliations;
            if (!Array.isArray(affs)) affs = Object.values(affs);
            orgAffiliations = affs.filter(aff => aff.title && aff.title !== 'W3C' && !aff.title != 'W3C Invited Experts');
            // W3C staffかチェック
            isW3CStaff = affs.some(aff => aff.title === 'W3C');
            // Invited Expertかチェック
            isInvitedExpert = affs.some(aff =>
              aff.title === 'W3C Invited Experts');
            // membersFromUsersMap: orgのURLをkey, dataをvalue
            for (const org of orgAffiliations) {
              if (org.href && !membersFromUsersMap.has(org.href)) {
                const orgData = findByDataUrl(org.href);
                if (orgData) membersFromUsersMap.set(org.href, { name: org.title, orgHref: org.href });
              }
            }
          }
        }
        if (isInvitedExpert) {
          invitedExpertsFromUsersMap.set(userHref, { name: user.title, userHref });
        } else if (isW3CStaff) {
          staffsFromUsersMap.set(userHref, { name: user.title, userHref });
        } else {
          individualsFromUsersMap.set(userHref, { name: user.title, userHref });
        }
      } catch (e) {
        console.error(`Exception in processing user ${user.href}: ${String(e)}`);
      }
    }
  }
  return { membersFromUsersMap, individualsFromUsersMap, invitedExpertsFromUsersMap, staffsFromUsersMap };
}

// グループごとの集計情報を取得
function extractGroupInfo(group) {
  if (group.title == 'AB Liaisons to the Board of Directors') {
    console.log('Debug: Processing AB Liaisons to the Board of Directors');
  }
  if (group.title.startsWith("Invisible Markup Community Group")) {
    console.log('Debug: Processing ixml group with exception handling');
  }

  if (group.title.startsWith("Chairs of the Board, AB, and TAG")) {
    console.log('Debug:Chairs of the Board, AB, and TAG exception handling');
  }

  if (group.groupType === 'tf') {
    console.log(`Debug: Processing 'tf' group: ${group.title || group.name || 'Unknown Group'}`);
  }

  const name = group.title || group.name || 'Unknown Group';
  const groupType = group.groupType || 'unknown';
  // グループ詳細
  const groupDetail = findByDataUrl(group.href);
  const homepage = groupDetail?._links?.homepage?.href;

  // participationsを分類
  const {
    membersFromParticipationsMap,
    usersFromParticipationsMap,
    individualsFromParticipationsMap,
    invitedExpertsFromParticipationsMap,
    staffsFromParticipationsMap
  } = getParticipationsClassificationMaps(groupDetail);

  // usersを分類
  const {
    membersFromUsersMap,
    individualsFromUsersMap,
    invitedExpertsFromUsersMap,
    staffsFromUsersMap
  } = getUsersClassificationMaps(groupDetail);

  // 各Mapをマージ（key重複時はparticipations優先）
  const mergedMembersMap = new Map([...membersFromUsersMap, ...membersFromParticipationsMap]);
  const mergedInvitedExpertsMap = new Map([...invitedExpertsFromUsersMap, ...invitedExpertsFromParticipationsMap]);
  const mergedStaffsMap = new Map([...staffsFromUsersMap, ...staffsFromParticipationsMap]);
  const mergedIndividualsMap = new Map([...individualsFromUsersMap, ...individualsFromParticipationsMap]);

  // Participants = Users + Invited Experts + Individuals + Staffs  
  const allParticipantsMap = new Map([
    ...usersFromParticipationsMap,
    ...mergedInvitedExpertsMap,
    ...mergedIndividualsMap,
    ...mergedStaffsMap
  ]);

  const groupInfo = new GroupInfo({
    name,
    groupType,
    membersCount: mergedMembersMap.size,
    membersMap: mergedMembersMap,
    memberParticipantsCount: usersFromParticipationsMap.size,
    memberParticipants: usersFromParticipationsMap.size > 0 ? Array.from(usersFromParticipationsMap.values()).map(v => v.name) : [],
    invitedExpertsCount: mergedInvitedExpertsMap.size,
    invitedExperts: mergedInvitedExpertsMap.size > 0 ? Array.from(mergedInvitedExpertsMap.values()).map(v => v.name) : [],
    individualsCount: mergedIndividualsMap.size,
    individuals: mergedIndividualsMap.size > 0 ? Array.from(mergedIndividualsMap.values()).map(v => v.name) : [],
    staffsCount: mergedStaffsMap.size,
    staffs: mergedStaffsMap.size > 0 ? Array.from(mergedStaffsMap.values()).map(v => v.name) : [],
    allParticipantsCount: allParticipantsMap.size,
    allParticipants: allParticipantsMap.size > 0 ? Array.from(allParticipantsMap.values()).map(v => v.name) : [],
    isException: usersFromParticipationsMap.size === 0 && individualsFromParticipationsMap.size > 0,  // some IGs and other groups.
    homepage
  });
  return groupInfo;
}

// すべてのグループ情報を取得（メイン関数）
async function getAllGroupsInfo() {
  await loadData();
  const groups = extractGroups();

  const result = groups.map(group => extractGroupInfo(group));

  // _metadataを追加
  result._metadata = globalApiData.groupsData._metadata;

  return result;
}