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
  const participations = data?._links?.participations || [];
  
  return participations;
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
  
  // グループの詳細データを取得
  const groupDetail = findDataByUrl(apiData.groupsData, apiData.participationsData, apiData.usersData, apiData.affiliationsData, group.href);
  const homepage = groupDetail?._links?.homepage?.href;
  
  // participations を取得
  const participations = getParticipationsForGroup(apiData, group);
  
  // participationsが空の場合、usersエンドポイントを使用
  const users = getUsersForGroup(apiData, group);
  
  // invited experts を抽出（participation 詳細から）
  const invited = [];
  const individuals = [];
  const staffs = [];
  const members = [];
  const usersFromParticipations = []; // メンバー組織の参加者（individual=false）
  const membersMap = {}; // メンバー組織 -> participants のマッピング
  
  for (const part of participations) {
    const partHref = part.href;
    if (!partHref) continue;
    
    const detail = getParticipationDetail(apiData, partHref);
    if (detail) {
      // user 情報を取得
      const userHref = detail._links?.user?.href;
      const userTitle = detail._links?.user?.title || userHref || 'Unknown';
      const orgTitle = detail._links?.organization?.title || part.title || 'Unknown';
      
      if (detail['invited-expert'] === true) {
        invited.push({ name: userTitle, userHref });
      } else if (detail['individual'] === true) {
        // Check if this is W3C staff by looking at affiliations
        const { affiliationsData } = apiData;
        const affiliationsHref = userHref ? userHref + '/affiliations' : null;
        let isW3CStaff = false;
        
        if (affiliationsHref) {
          const affiliationsEntry = affiliationsData[affiliationsHref];
          if (affiliationsEntry?.data?._links?.affiliations) {
            const affs = affiliationsEntry.data._links.affiliations;
            isW3CStaff = affs.some(aff => aff.title === 'W3C');
          }
        }
        
        if (isW3CStaff) {
          staffs.push({ name: userTitle, userHref });
        } else {
          individuals.push({ name: userTitle, userHref });
        }
      } else if (detail['individual'] === false) {
        // individual が false = メンバー組織の参加者
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
                usersFromParticipations.push(pItem.title); // Usersリストに追加
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
  
  // ========== EXCEPTION HANDLING START ==========
  // participations=0でusers>0の場合、usersエンドポイントのaffiliationsから分類
  // Note: IG, AB/TAG/BoD(other)などに適用。
  let finalUsers = usersFromParticipations;
  let finalMembers = members;
  const finalMembersMap = { ...membersMap }; // 例外処理用のmembersMapコピー
  
  if (participations.length === 0 && users.length > 0) {
    console.log(`[Exception] Group "${name}" has participations=0 but users=${users.length}, using affiliations-based classification`);
    
    // usersエンドポイントから各ユーザーの詳細を取得して分類
    const { groupsData, participationsData, usersData, affiliationsData } = apiData;
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
      
      if (affiliationsHref) {
        const affiliationsEntry = affiliationsData[affiliationsHref];
        if (affiliationsEntry?.data?._links?.affiliations) {
          const affs = affiliationsEntry.data._links.affiliations;
          
          // 全ユーザーのaffiliationsを出力
          console.log(`  [Debug] User #${processedCount} "${userTitle}": affiliations=${JSON.stringify(affs.map(a => a.title))}`);
          
          if (affs.length === 0) {
            affEmptyCount++;
            console.log(`  [Debug] User #${processedCount} "${userTitle}": EMPTY affiliations`);
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
          
          console.log(`  [Debug] User #${processedCount} "${userTitle}": IE=${isInvitedExpert}, Staff=${isW3CStaff}, OrgCount=${orgCount}, TotalOrgs=${organizationsSet.size}`);
        } else {
          affDataMissingCount++;
          console.log(`  [Debug] User #${processedCount} "${userTitle}": No affiliations data`);
        }
      } else {
        console.log(`  [Debug] User #${processedCount} "${userTitle}": No affiliations href`);
      }
      
      // 分類
      if (isInvitedExpert) {
        invited.push({ name: userTitle, userHref });
      } else if (isW3CStaff) {
        staffs.push({ name: userTitle, userHref });
      } else {
        // organization affiliationがあるかチェック
        if (affiliationsHref) {
          const affiliationsEntry2 = affiliationsData[affiliationsHref];
          let hasOrgAffiliation = false;
          
          if (affiliationsEntry2?.data?._links?.affiliations) {
            const affs = affiliationsEntry2.data._links.affiliations;
            // W3C以外の組織があればUsers、なければIndividuals
            hasOrgAffiliation = affs.some(aff => aff.title !== 'W3C' && !aff.title?.toLowerCase().includes('invited expert'));
          }
          
          if (hasOrgAffiliation) {
            finalUsers.push(userTitle);
          } else {
            individuals.push({ name: userTitle, userHref });
          }
        } else {
          // affiliations hrefがない場合はIndividuals
          individuals.push({ name: userTitle, userHref });
        }
      }
    }    console.log(`[Exception] Group "${name}": Processed ${processedCount} users`);
    
    // 組織をMembersとして設定
    finalMembers = Array.from(organizationsSet);
    
    // membersMapを構築（組織 -> ユーザーリスト）
    for (const org of finalMembers) {
      finalMembersMap[org] = orgToUsersMap[org] || [];
    }
    
    console.log(`[Exception] Group "${name}": Found M=${finalMembers.length}, U=${finalUsers.length}, IE=${invited.length}, S=${staffs.length}, Ind=${individuals.length}`);
    console.log(`[Exception] Group "${name}" Members:`, finalMembers);
    console.log(`[Exception] Group "${name}" Data status: Users=${users.length}, Affiliations missing=${affDataMissingCount}, Affiliations empty=${affEmptyCount}`);
  }
  // ========== EXCEPTION HANDLING END ==========
  
  // invited配列は{name, userHref}形式のまま返す
  const uniqInvited = invited.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
  const uniqIndividuals = individuals.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
  const uniqStaffs = staffs.filter((v, i, arr) => arr.findIndex(x => x.name === v.name && x.userHref === v.userHref) === i);
  const uniqMembers = Array.from(new Set(finalMembers));
  const uniqUsers = Array.from(new Set(finalUsers));
  
  // Members = Participations - Invited Experts - Individuals - Staffs
  const membersCount = uniqMembers.length;
  // Participants = Users + Invited Experts + Individuals + Staffs
  const totalParticipantsCount = uniqUsers.length + uniqInvited.length + uniqIndividuals.length + uniqStaffs.length;
  // Participants のリスト (Users + Invited Experts + Individuals + Staffs)
  const totalParticipantsList = [
    ...uniqUsers,
    ...uniqInvited.map(v => v.name),
    ...uniqIndividuals.map(v => v.name),
    ...uniqStaffs.map(v => v.name)
  ];
  
  return {
    name,
    groupType,
    participantsCount: participations.length,
    participantsList: uniqMembers,
    membersMap: finalMembersMap, // 例外処理でも対応したmembersMapを使用
    usersCount: uniqUsers.length,
    usersList: uniqUsers,
    invitedCount: uniqInvited.length,
    invited: uniqInvited,
    individualsCount: uniqIndividuals.length,
    individuals: uniqIndividuals,
    staffsCount: uniqStaffs.length,
    staffs: uniqStaffs,
    membersCount: uniqMembers.length,
    totalParticipantsCount,
    totalParticipantsList,
    isException: participations.length === 0 && users.length > 0,
    homepage
  };
}

// すべてのグループ情報を取得（メイン関数）
async function getAllGroupsInfo() {
  const apiData = await loadData();
  const groups = extractGroups(apiData);
  
  const result = groups.map(group => {
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
        staffsCount: 0,
        staffs: [],
        membersCount: 0,
        totalParticipantsCount: 0,
        totalParticipantsList: [],
        _error: e.message || String(e)
      };
    }
  }).sort((a, b) => (b.invitedCount || 0) - (a.invitedCount || 0));
  
  // _metadataを追加
  result._metadata = apiData.groupsData._metadata;
  
  return result;
}