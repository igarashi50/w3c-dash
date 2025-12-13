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
            if (partDetail['individual'] === false) {
              const orgTitle = partDetail._links?.organization?.title || part.title || 'Unknown';
              const affiliationHref = partDetail._links?.organization?.href;
              if (affiliationHref) {
                const affData = findByDataUrl(affiliationHref);
                if (affData) {
                  const isMember = affData['is-member']
                  if (!isMember) {
                    if (groupType === 'working group' || groupType === 'interest group') {
                      // WG/IGの場合、メンバーシップであるはずなので警告を出す
                      console.log(`Warning: ${orgTitle} in ${groupType}: ${org} is a not W3C member's organization, skipping as member`);
                    } else if (groupType === 'community group' || groupType === 'task force' || groupType === 'other') {
                      // CG/TF/Otherの場合、メンバーシップでない場合もあるので警告は出さない
                      console.log(`  [Info] ${orgTitle} in ${groupType}: ${org} is a not W3C member's organization, skipping as member`);
                    }
                    continue;
                  }
                } else {
                  console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${orgTitle}`);
                  ccontinue;
                }
              } else {
                console.warn(`Warning: Participation ${part.href} of ${org} has no organization href`);
                continue;
              }

              if (!membersMap.has(orgTitle)) membersMap.set(orgTitle, []); // 会員なのでMemberとして追加
              // participantsエンドポイントからMenbaからの参加者を追加
              const participantsHref = partDetail._links?.participants?.href;
              if (participantsHref) {
                const participantsData = findByDataUrl(participantsHref);  // // participatonsの場合はaffiliationsは一つだけ
                let participantItems = participantsData?._links?.participants || [];
                if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
                  participantItems = Object.values(participantItems);
                }
                for (const pItem of participantItems) {
                  if (pItem.href && pItem.title) {
                    // usersMap: userHref -> userObj
                    memberParticipantsMap.set(pItem.href, { name: pItem.title, userHref: pItem.href });
                    // membersMap: orgTitle -> [{name, userHref}]
                    if (!membersMap.get(orgTitle).some(u => u.userHref === pItem.href)) {
                      membersMap.get(orgTitle).push({ name: pItem.title, userHref: pItem.href });
                    }
                  }
                }
              }
            } else if (partDetail['individual'] === true) { // Invited Experts: individual=true, invited-expert=true
              if (partDetail['invited-expert'] === true) {
                const userHref = partDetail._links?.user?.href;
                const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
                if (userHref) invitedExpertsMap.set(userHref, { name: userTitle, userHref });
              } else {        // Indivisuals or Staffs: individual=true, invited-expert=false
                const userHref = partDetail._links?.user?.href;
                const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';

                if (userHref) {
                  const userData = findByDataUrl(userHref);
                  const afflicationsHref = userData?._links?.affiliations?.href;
                  if (!afflicationsHref) {
                    // console.warn(`Warning: Participation ${part.href} of ${userTitle} has no organization href`);
                    continue; // 個人参加の場合は組織がないこともあるので警告は出さない
                  }
                  const { isW3CStaff, isInviedExpert, isMember, afflications } = checkAffiliations(afflicationsHref);
                  if (isW3CStaff) {
                    staffsMap.set(userHref, { name: userTitle, userHref });
                  } else if (isMember) {
                    if (groupType == 'working group' || groupType == 'interest group') {
                      console.log(`  Warning: User "${userTitle}" in group "${groupType}" is classified as Individual without W3C staff affiliation`);
                    } else {
                      memberParticipantsMap.set(userHref, { name: userTitle, userHref });
                    }
                  } else {
                    individualsMap.set(userHref, { name: userTitle, userHref });
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
    const affiliationsEntry = findByDataUrl(affiliationsHref);
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
      const affData = findByDataUrl(affiliationHref);
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
      const userDetail = findByDataUrl(userHref);
      const userTitle = user.title || 'Unknown';
      const affiliationsHref = userDetail?._links?.affiliations?.href;
      const affTitle = userDetail?._links?.affiliations?.title || 'Unknown';
      if (affiliationsHref) {
        let { isMember, isW3CStaff, isInvitedExpert, afflications } = checkAffiliations(affiliationsHref);
        if (isMember) {
          if (afflications.length != 1) {
            console.log(`  Warning: User "${user.title}" has multiple affiliations, skip saving as member participant`);
          } else {
            const affHref = afflications[0].href;
            const orgTitle = afflications[0].title || 'Unknown';
            // 1. set時に配列で初期化
            if (!membersMap.has(orgTitle)) {
              membersMap.set(orgTitle, []);
            }
            // 2. getもaffHrefで統一
            if (!membersMap.get(orgTitle).some(u => u.userHref === userHref)) {
              membersMap.get(orgTitle).push({ name: userTitle, userHref });
            }
            memberParticipantsMap.set(userHref, { name: userTitle, userHref });
          }
        } else if (isInvitedExpert) {
          if (groupType === 'working group' || groupType === 'interest group') {
            console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Invited Expert without W3C staff affiliation`);
          } else {
            invitedExpertsMap.set(userHref, { name: user.title, userHref });
          }
        } else if (isW3CStaff) {
          staffsMap.set(userHref, { name: user.title, userHref });
        } else {
          if (groupType === 'working group') {
            console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Individual without W3C staff affiliation`);
          } else {
            individualsMap.set(userHref, { name: user.title, userHref });
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
  const groupDetail = findByDataUrl(group.href);
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
    membersCount: membersMap.size,
    membersMap: membersMap,
    memberParticipantsCount: memberParticipantsMap.size,
    memberParticipants: memberParticipantsMap.size > 0 ? Array.from(memberParticipantsMap.values()) : [],
    invitedExpertsCount: invitedExpertsMap.size,
    invitedExperts: invitedExpertsMap.size > 0 ? Array.from(invitedExpertsMap.values()) : [],
    individualsCount: individualsMap.size,
    individuals: individualsMap.size > 0 ? Array.from(individualsMap.values()) : [],
    staffsCount: staffsMap.size,
    staffs: staffsMap.size > 0 ? Array.from(staffsMap.values()) : [],
    allParticipantsCount: allParticipantsArray.length,
    allParticipants: allParticipantsArray,
    isException: isIndivisualParticipationGroup,  // some IGs, task forces and other groups, e.g. ab.
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
