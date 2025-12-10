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
      console.warn(`warning: No data found for URL ${targetUrl}`);
      return null;
    }
    let data = entry.data;
    if (data._error) {
      console.warn(`error: datafor URL ${targetUrl} has error: ${data._error}`);
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



// participation の詳細データを取得
function getParticipationDetail(participationHref) {
  const detail = findByDataUrl(participationHref);
  if (!detail) return null;
  return detail;
}

// グループごとの集計情報を取得
function extractGroupInfo(group) {
  try {
    if (group.title == 'AB Liaisons to the Board of Directors') {
      console.log('Debug: Processing AB Liaisons to the Board of Directors');
    }
    const name = group.title || group.name || 'Unknown Group';
    const groupType = group.groupType || 'unknown';
    // グループ詳細
    const groupDetail = findByDataUrl(group.href);
    const homepage = groupDetail?._links?.homepage?.href;
    // participations
    const participationsUrl = groupDetail?._links?.participations?.href;
    let participations = [];
    if (participationsUrl) {
      const participationsData = findByDataUrl(participationsUrl);
      participations = Object.values(participationsData?._links?.participations) || [];
    }
    // users
    const usersUrl = groupDetail?._links?.users?.href;
    let users = [];
    if (usersUrl) {
      const usersData = findByDataUrl(usersUrl);
      if (usersData) {
        users = Object.values(usersData?._links?.users || []);
      } else {
        console.warn(`Warning: No users data found for URL: ${usersUrl}`);
      }
    }
    const invitedExperts = [];
    const individuals = [];
    const staffs = [];
    const members = [];
    const usersFromParticipations = [];
    const usersFromParticipationsDetailed = [];
    const membersMap = {};

    for (const part of participations) {
      const partHref = part.href;
      if (!partHref) continue;
      const partDetail = findByDataUrl(partHref);
      if (!partDetail) continue;
      const orgTitle = partDetail._links?.organization?.title || part.title || 'Unknown';
      // Members: individual=false, invited-expert=false
      if (partDetail['individual'] === false && partDetail['invited-expert'] === false) {
        const affiliationHref = partDetail._links?.organization?.href;
        if (affiliationHref) {
          const affData = findByDataUrl(affiliationHref);
          if (affData) {
            const isMember = affData['is-member']
            if (!isMember) {
              if (groupType === 'wg' || groupType === 'ig') {
                // WG/IGの場合、メンバーシップであるはずなので警告を出す
                console.log(`Warning: ${orgTitle} in ${groupType}: ${name} is a not W3C member's organization, skipping as member`);
              }
              continue; 
            }
          } else {
            console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${name}`);
          }
        } else {
          console.warn(`Warning: Participation ${partHref} of ${name} has no organization href`);
        }
        // 重複していなければメンバーに追加
        if (!members.includes(orgTitle)) members.push(orgTitle);
        if (!membersMap[orgTitle]) membersMap[orgTitle] = [];
        // participantsエンドポイントから個人を取得
        const participantsHref = partDetail._links?.participants?.href;
        if (participantsHref) {
          const participantsData = findByDataUrl(participantsHref);
          if (participantsData) {
            let participantItems = participantsData._links?.participants || [];
            // オブジェクトの場合は配列化
            if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
              participantItems = Object.values(participantItems);
            }
            for (const pItem of participantItems) {
              if (pItem.href && pItem.title) {
                usersFromParticipations.push(pItem.title);
                usersFromParticipationsDetailed.push({ name: pItem.title, userHref: pItem.href });
                // 重複しないように
                if (!membersMap[orgTitle].some(u => u.userHref === pItem.href)) {
                  membersMap[orgTitle].push({ name: pItem.title, userHref: pItem.href });
                }
              }
            }
          }
        }
      }
      // Invited Experts: individual=true, invited-expert=true
      else if (partDetail['individual'] === true && partDetail['invited-expert'] === true) {
        const userHref = partDetail._links?.user?.href;
        const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
        invitedExperts.push({ name: userTitle, userHref });
      }
      // Individuals/Staffs: individual=true, invited-expert=false
      else if (partDetail['individual'] === true && partDetail['invited-expert'] === false) {
        const userHref = partDetail._links?.user?.href;
        const userTitle = partDetail._links?.user?.title || userHref || 'Unknown';
        const affiliationsHref = userHref ? userHref + '/affiliations' : null;
        let isW3CStaff = false;
        if (affiliationsHref) {
          const affiliationsEntry = findByDataUrl(affiliationsHref);
          if (affiliationsEntry?._links?.affiliations) {
            let affs = affiliationsEntry._links.affiliations;
            if (affs == undefined) {
              console.log(`  [Debug] User "${userTitle}": EMPTY affiliations`);
            } else {
              // オブジェクトの場合は配列化
              if (!Array.isArray(affs)) affs = Object.values(affs);
              isW3CStaff = affs.some(aff => aff.title === 'W3C');
            }
          }
        }
        if (isW3CStaff) {
          staffs.push({ name: userTitle, userHref });
        } else {
          individuals.push({ name: userTitle, userHref });
        }
      }
    }

    // ========== EXCEPTION HANDLING START ==========
    // participations=0でusers>0の場合、usersエンドポイントのaffiliationsから分類
    // Note: IG, AB/TAG/BoD(other)などに適用。
    let finalUsers = usersFromParticipations;
    let finalUsersDetailed = usersFromParticipationsDetailed;
    let finalMembers = members;
    const finalMembersMap = { ...membersMap }; // 例外処理用のmembersMapコピー

    if (participations.length === 0 && users.length > 0) {
      console.log(`[Exception] Group "${name}" has participations=0 but users=${users.length}, using affiliations-based classification`);

      // usersエンドポイントから各ユーザーの詳細を取得して分類
      const organizationsSet = new Set(); // 組織を収集
      const orgToUsersMap = {}; // 組織 -> ユーザーのマッピング

      let affDataMissingCount = 0;
      let affEmptyCount = 0;
      let processedCount = 0;

      for (const userLink of users) {
        const userHref = userLink.href;
        const userTitle = userLink.title || userLink.name || 'Unknown';
        processedCount++;

        // affiliationsを取得してW3C staffかチェック
        const affiliationsHref = userHref ? userHref + '/affiliations' : null;
        let isW3CStaff = false;
        let isInvitedExpert = false;

        let affs = [];
        if (affiliationsHref) {
          const affiliationsEntry = findByDataUrl(affiliationsHref);
          if (affiliationsEntry && affiliationsEntry._links && affiliationsEntry._links.affiliations) {
            affs = affiliationsEntry._links.affiliations;
            if (!Array.isArray(affs)) affs = Object.values(affs);
            // 全ユーザーのaffiliationsを出力
            // console.log(`  [Debug] User #${processedCount} "${userTitle}": affiliations=${JSON.stringify(affs.map(a => a.title))}`);
            if (affs.length === 0) {
              affEmptyCount++;
              // console.log(`  [Debug] User #${processedCount} "${userTitle}": EMPTY affiliations`);
            }
            // W3C staffかチェック
            isW3CStaff = affs.some(aff => aff.title === 'W3C');
            // Invited Expertかチェック（affiliationに"Invited Expert"があるか）
            isInvitedExpert = affs.some(aff =>
              aff.title?.toLowerCase().includes('invited expert') ||
              aff.href?.includes('invited-expert')
            );
            // 組織を収集
            let orgCount = 0;
            affs.forEach(aff => {
              const affTitle = aff.title;
              if (affTitle && affTitle !== 'W3C' && !affTitle.toLowerCase().includes('invited expert')) {
                organizationsSet.add(affTitle);
                orgCount++;
                // orgToUsersMapに追加
                if (!orgToUsersMap[affTitle]) {
                  orgToUsersMap[affTitle] = [];
                }
                orgToUsersMap[affTitle].push({
                  name: userTitle,
                  userHref: userHref
                });
              }
            });
            // console.log(`  [Debug] User #${processedCount} "${userTitle}": IE=${isInvitedExpert}, Staff=${isW3CStaff}, OrgCount=${orgCount}, TotalOrgs=${organizationsSet.size}`);
          } else {
            affDataMissingCount++;
            console.log(`  [Debug] User #${processedCount} "${userTitle}": No affiliations data`);
          }
        } else {
          console.log(`  [Debug] User #${processedCount} "${userTitle}": No affiliations href`);
        }

        // 分類
        if (isInvitedExpert) {
          invitedExperts.push({ name: userTitle, userHref });
        } else if (isW3CStaff) {
          staffs.push({ name: userTitle, userHref });
        } else {
          // organization affiliationがあるかチェック
          let hasOrgAffiliation = false;
          if (affs.length > 0) {
            hasOrgAffiliation = affs.some(aff => aff.title !== 'W3C' && !aff.title?.toLowerCase().includes('invited expert'));
          }
          if (hasOrgAffiliation) {
            finalUsers.push(userTitle);
            finalUsersDetailed.push({ name: userTitle, userHref });
          } else {
            individuals.push({ name: userTitle, userHref });
          }
        }
      }
      console.log(`[Exception] Group "${name}": Processed ${processedCount} users`);

      // 組織をMembersとして設定
      finalMembers = Array.from(organizationsSet);

      // membersMapを構築（組織 -> ユーザーリスト）
      for (const org of finalMembers) {
        finalMembersMap[org] = orgToUsersMap[org] || [];
      }

      console.log(`[Exception] Group "${name}": Found M=${finalMembers.length}, U=${finalUsers.length}, IE=${invitedExperts.length}, S=${staffs.length}, Ind=${individuals.length}`);
      console.log(`[Exception] Group "${name}" Members:`, finalMembers);
      console.log(`[Exception] Group "${name}" Data status: Users=${users.length}, Affiliations missing=${affDataMissingCount}, Affiliations empty=${affEmptyCount}`);
    }
    // ========== EXCEPTION HANDLING END ==========

    // invited配列は{name, userHref}形式のまま返す
    const uniqInvitedExperts = invitedExperts.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
    const uniqIndividuals = individuals.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
    const uniqStaffs = staffs.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
    // memberParticipants: {name, userHref} 形式
    const uniqUsersDetailed = finalUsersDetailed.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);

    // Participants = Users + Invited Experts + Individuals + Staffs
    const allParticipants = [
      ...uniqUsersDetailed,
      ...uniqInvitedExperts,
      ...uniqIndividuals,
      ...uniqStaffs
    ];

    return new GroupInfo({
      name,
      groupType,
      membersCount: Object.keys(finalMembersMap).length,
      membersMap: finalMembersMap,
      memberParticipantsCount: uniqUsersDetailed.length,
      memberParticipants: uniqUsersDetailed,
      invitedExpertsCount: uniqInvitedExperts.length,
      invitedExperts: uniqInvitedExperts,
      individualsCount: uniqIndividuals.length,
      individuals: uniqIndividuals,
      staffsCount: uniqStaffs.length,
      staffs: uniqStaffs,
      allParticipantsCount: Object.keys(allParticipants).length,
      allParticipants: allParticipants,
      isException: participations.length === 0 && users.length > 0,
      homepage
    });
  } catch (e) {
    console.error(`Exception in extractGroupInfo group ${group.title || 'Unknown'} group.href=${group.href || 'Unknown'}: ${String(e)}`);
    return new GroupInfo({
      _error: e.message || String(e)
    });
  }
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