// w3c-stats.js　as ES module

/* Export the following two functions.
export function makeStats()
export function getDataEntry()
*/

let globalApiData = undefined;

class GroupInfo {
  constructor({
    name = 'Unknown',
    shortname = undefined,
    groupType = 'unknown',
    homepage = '',

    // participations
    membersMap = new Map(),
    memberParticipants = [],
    invitedExperts = [],
    individuals = [],
    staffs = [],
    allParticipants = [],
    isException = false,

    // specs
    specsMap = new Map(),
    recommendations = [],  // recommendations
    candidateRecommendations = [], // candidate recommendation
    draftStandards = [],  // draft standards
    retiredSpecs = [], // retired specifications
    otherSpecs = [],  // note draft, notes,  statements, draft registry, registry
    allVersions = [],  // all versions = recommendations + candidateRecommendations + draftStandards + retiredSpecs + otherSpecs

    _error = undefined
  } = {}) {
    this.name = name;
    this.shortname = shortname;
    this.groupType = groupType;
    this.homepage = homepage;
    // participations
    this.membersMap = membersMap;
    this.memberParticipants = memberParticipants;
    this.invitedExperts = invitedExperts;
    this.individuals = individuals;
    this.staffs = staffs;
    this.allParticipants = allParticipants;
    this.isException = isException;

    // specs
    this.specsMap = specsMap;
    this.recommendations = recommendations;
    this.candidateRecommendations = candidateRecommendations;
    this.draftStandards = draftStandards;
    this.retiredSpecs = retiredSpecs;
    this.otherSpecs = otherSpecs;
    this.allVersions = allVersions;

    this._error = _error;
  }
}

export function getDataEntry(targetUrl) {
  try {
    if (globalApiData == undefined) {
      console.error('Error: globalApiData is not loaded. Please run makeStats() first.');
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
    } else if (targetUrl.startsWith('https://api.w3.org/specifications/') ||
      targetUrl.startsWith('https://api.w3.org/specification-series/')) {
      entry = globalApiData.specificationsData[targetUrl];
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

export function getTimelineData() {
  return globalApiData.timelineData;
}

// WG, IG, CG, TF, Other のグループリストを取得
function extractGroups(apiData) {
  let groups = [];
  const types = ['wg', 'ig', 'cg', 'tf', 'other'];

  for (const type of types) {
    const url = `https://api.w3.org/groups/${type}`;
    const data = getDataEntry(url);
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
function getParticipationsClassificationMaps(groupType, shortname, participationsUrl) {
  const membersMap = new Map();
  const memberParticipantsMap = new Map(); // userHref -> userObj
  const individualsMap = new Map(); // userHref -> userObj  
  const invitedExpertsMap = new Map();
  const staffsMap = new Map();
  // groupDetailは呼び出し元で取得済み
  // orgは不要

  if (participationsUrl) {
    try {
      const participationsData = getDataEntry(participationsUrl);
      let participationsArray = participationsData?._links?.participations || [];
      if (participationsArray && typeof participationsArray === 'object' && !Array.isArray(participationsArray)) {
        participationsArray = Object.values(participationsArray);
      }
      if (Array.isArray(participationsArray) && participationsArray.length > 0) {
        for (const part of participationsArray) {
          try {
            const partDetail = getDataEntry(part.href);
            // Members: individual=false, invited-expert=false
            if (partDetail['individual'] === false) {
              const data = makeOrginizationParticipants(partDetail, groupType);
              if (data) {
                const participantsArray = data.participantsArray;

                if (data.partType == "MP") {
                  addParticipantsArrayToMembersMap(shortname, data.memberAffiliation, participantsArray, membersMap); // 会員なのでMemberとして追加
                  addParticipantsArrayToMap(participantsArray, memberParticipantsMap);
                } else if (data.partType == "Ind") {
                  // Note 45 IEs participates in cg with their orginization, so need to add them to IE map instead of individuals map
                  for (const participant of participantsArray) {
                    if (participant.partType === "IE") {
                      console.warn(`  Warning: Participant "${participant.name}" in ${groupType} is classified as Invited Expert participates as their organization. ${partDetail._links?.organization?.title || 'Unknown Organization'}`);
                      addParticipantToMap(participant, invitedExpertsMap);
                    } else if (participant.partType === "Ind") {
                      addParticipantToMap(participant, individualsMap);
                    } else {
                      console.error(`Error: participant in originzation at ${part.href} is but ${participant.partType}: ${participant.name}, ${participant.userHref}`);
                    }
                  }
                } else {
                  console.error(`Error: unknown partType of orginization's partiicpants at ${part.href}`);
                }
              }
            } else if (partDetail['individual'] === true) { // Invited Experts: individual=true, invited-expert=true
              const data = makeIndividualParticipant(partDetail, groupType);
              if (data) {
                const participant = data.participant;
                if (data.partType == "IE") {
                  addParticipantToMap(participant, invitedExpertsMap);
                } else if (data.partType == 'S') {
                  addParticipantToMap(participant, staffsMap);
                } else if (data.partType == "MP") {
                  addParticipantToMembersMap(shortname, data.memberAffiliation, participant, membersMap);
                  addParticipantToMap(participant, memberParticipantsMap);
                } else if (data.partType == "Ind") {
                  addParticipantToMap(participant, individualsMap);
                } else {
                  console.error(`Error: unknown partType of an indivisual partiicpant at ${part.href}`);
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

function checkAffiliations(userTitle, affiliationsHref) {
  let partType = "Ind"; // default
  let memberAffiliation = undefined;

  try {
    if (!affiliationsHref) {
      // there is a user who does not register affiliations
    } else {
      const affiliationsEntry = getDataEntry(affiliationsHref);
      let affs = affiliationsEntry?._links?.affiliations;
      // affsがundefined/nullなら空配列、配列でなければObject.valuesで配列化
      if (!affs) {
        // console.warn(` Warning: User ${userTitle}'s affiliation ${affiliationsHref} has no affiliations`);
      } else {
        if (!Array.isArray(affs)) {
          affs = Object.values(affs);
        }
        for (const aff of affs) {
          const affiliationHref = aff.href;
          const affTitle = aff.title || 'Unknown';
          if (!affiliationHref) {
            console.warn(`Warning: User ${userTitle}'s affiliation ${aff} has no affiliation href`);
            continue;
          }
          const affData = getDataEntry(affiliationHref);
          if (!affData) {
            console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${affTitle}`);
            continue;
          }
          if (affData.name === 'W3C') {
            partType = "S";
          } else if (affData.name === 'W3C Invited Experts') {
            partType = "IE";
          } else if (affData['is-member'] === true) {
            partType = "MP";
            memberAffiliation = aff;
          } else {
            // go thru  since it may be classfied as the affType other than Ind.
          }
        }
      }
    }
  } catch (e) {
    console.error(`Exception in checkAffiliations for URL ${affiliationsHref}: ${String(e)}`);
  }
  /* for debug
  if (affiliations.length > 1) {
    console.log(` Info: '${userTitle}' has multiple affiliations: ${affiliations.map(a => a.title).join(', ')}`);
  }
  */
  return { partType, memberAffiliation };
}

function makeOrginizationParticipants(partDetail, groupType) {
  let partType = undefined;
  let memberAffiliation = undefined;

  const orginization = partDetail._links?.organization;
  const orgTitle = orginization.title || 'Unknown';
  const orgHref = orginization?.href;

  if (!orgHref) {
    console.warn(`Warning: Participation ${part.href} of ${orgTitle} has no organization href`);
    return undefined
  }

  const participantsHref = partDetail._links?.participants?.href;
  const affData = getDataEntry(orgHref);
  if (affData) {
    const isMember = affData['is-member'];
    if (isMember) {
      partType = "MP";
      memberAffiliation = orginization;
    } else {
      if (groupType === 'wg' || groupType === 'ig') {
        // WG/IGの場合、メンバーシップであるはずなので警告を出す
        console.log(`Warning: ${orgTitle} in ${groupType} is a not W3C member's organization, skipping as member`);
        return undefined
      } else if (groupType === 'cg' || groupType === 'tf' || groupType === 'other') {
        // CG/TF/Otherの場合、メンバーシップでない場合もあるので警告は出さない
        // console.log(`  [Info] ${orgTitle} in q${groupType}: ${org} is a not W3C member's organization, skipping as member`);
        partType = "Ind";
      }
    }
  } else {
    console.warn(`Warning: Organization data not found for href ${affiliationHref} of ${orgTitle}`);
    return undefined
  }

  if (participantsHref) {
    const participantsData = getDataEntry(participantsHref);  // // participatonsの場合はaffiliationsは一つだけ
    let participantItems = participantsData?._links?.participants ||
      participantsData?._links?.users ||  // W3C API had changed the property name from 'participatations' to 'users' at Feb. 22, 2026. 
      [];
    if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
      participantItems = Object.values(participantItems);
    }
    const participantsArray = [];
    for (const pItem of participantItems) {
      const { participant, memberAffiliation } = makeParticipant(pItem);
      participantsArray.push(participant);
    }
    return { partType, memberAffiliation, participantsArray };
  }
  return undefined
}

function makeIndividualParticipant(partDetail, groupType) {
  let partType = undefined;
  const user = partDetail._links?.user;
  const userTitle = user?.title || 'Unknown';
  const { participant, memberAffiliation } = makeParticipant(user);

  if (partDetail['invited-expert'] === true) {
    if (participant.partType !== 'IE') {
      console.warn(`  Warning: User "${userTitle}" have invited-expert=true in ${groupType}, but it is clasified as ${participant.partType}.`);
    }
    partType = "IE";
  } else {        // Indivisuals or Staffs: individual=true, invited-expert=false
    if (participant.partType === 'S') {
      partType = 'S';
    } else if (participant.partType == 'MP') {
      partType = "MP";
    } else if (participant.partType === 'IE') {
      if (groupType == 'wg' || groupType == 'ig') {
        console.warn(`  Warning: User "${userTitle}" in wg and ig group "${groupType}"`);
      }
      partType = "IE";
    } else if (participant.partType === 'Ind') {
      partType = "Ind";
    } else {
      console.warn(`  Warning: User "${userTitle}" has unknown partType`);
    }
  }
  return { partType, memberAffiliation, participant };
}


// urersUrlからusers情報を読み各種Mapを返す
function getUsersClassificationMaps(groupType, shortname, usersUrl) {
  const membersMap = new Map(); // orgUrl -> orgData
  const memberParticipantsMap = new Map(); // orgUrl -> userObj
  const individualsMap = new Map(); // userHref -> userObj
  const invitedExpertsMap = new Map(); // userHref -> userObj
  const staffsMap = new Map(); // userHref -> userObj

  let usersMap = new Map();
  try {
    const usersData = getDataEntry(usersUrl);
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
      const { participant, memberAffiliation } = makeParticipant(user);
      const partType = participant.partType;
      if (partType == "MP") {
        if (!memberAffiliation.href) {
          console.log(`   Warning: User "${user.title}" has no url of memberAffiliation`);
        } else {
          addParticipantToMembersMap(shortname, memberAffiliation, participant, membersMap);
          addParticipantToMap(participant, memberParticipantsMap);
        }
      } else if (partType === "IE") {
        if (groupType === 'working group' || groupType === 'interest group') {
          console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Invited Expert without W3C staff affiliation`);
        } else {
          addParticipantToMap(participant, invitedExpertsMap);
        }
      } else if (partType === "S") {
        addParticipantToMap(participant, staffsMap);
      } else if (partType === "Ind") {
        if (groupType === 'working group') {
          console.log(`  Warning: User "${user.title}" in group "${groupType}" is classified as Individual without W3C staff affiliation`);
        } else {
          addParticipantToMap(participant, individualsMap);
        }
      }
    } catch (e) {
      console.error(`Exception in processing user ${user.href}: ${String(e)}`);
    }
  }
  return { membersMap, memberParticipantsMap, individualsMap, invitedExpertsMap, staffsMap };
}

function getStatusOrder(status) {
  const statusOrderMap = {
    'Recommendation': { order: 1, shortName: 'Rec' },
    'Statement': { order: 2, shortName: 'State' },
    'Registry': { order: 3, shortName: 'Reg' },
    'Proposed Recommendation': { order: 4, shortName: 'PR' },
    'Candidate Recommendation': { order: 5, shortName: 'CR' },
    'Note': { order: 6, shortName: 'Note' },
    'Candidate Recommendation Snapshot': { order: 7, shortName: 'CRS' },
    'Candidate Recommendation Draft': { order: 8, shortName: 'CRD' },
    'Last Call Working Draft': { order: 9, shortName: 'LCWD' },
    'Working Draft': { order: 10, shortName: 'WD' },
    'First Public Working Draft': { order: 11, shortName: 'FPWD' },
    'Draft Note': { order: 12, shortName: 'DN' },
    'Draft Registry': { order: 13, shortName: 'DR' },
    'Retired': { order: 14, shortName: 'Ret' },
  }
  return statusOrderMap[status] || { order: 99, shortName: '???' }; // 未知のステータスは最後に
}

function getSpecificationsClassificationMaps(groupType, specificationsArray) {
  const specsMap = new Map();
  const recommendations = []
  const candidateRecommendations = []
  const draftStandards = []
  const retiredSpecs = []
  const otherSpecs = []
  const allVersions = []

  for (const specEntry of specificationsArray) {
    const specUrl = specEntry.href;
    const specData = getDataEntry(specUrl);
    if (!specData) {
      console.log(`  [Warning] No specification data found for href: ${specUrl}, skipping`);
      continue;
    }
    const vertionHistoriesHref = specData._links?.['version-history']?.href;
    if (!vertionHistoriesHref) {
      console.log(`  [Error] No version-history found for href: ${specEntry.href}, skipping`);
      continue;
    }
    const versionHistoriesList = getDataEntry(vertionHistoriesHref);
    if (!versionHistoriesList || !Array.isArray(versionHistoriesList._links?.['version-history'])) {
      console.log(`  [Error] No version-history data found for href: ${vertionHistoriesHref}, skipping`);
      continue;
    }

    const latestVersionUrl = specData._links?.['latest-version']?.href;
    if (!latestVersionUrl) {
      console.log(`  [Error] No latest-version url found for href: ${latestVersionUrl}, skipping`);
      continue
    }

    const versions = versionHistoriesList._links['version-history'];
    const versionEntries = []
    let latestVersionEntry = undefined
    for (const version of versions) {
      const versionUrl = version.href;
      const versionData = getDataEntry(versionUrl);
      if (!versionData) {
        console.log(`  [Warning] No version data found for href: ${versionUrl}, skipping`);
        continue;
      }

      /*
      const successor = versionData._links?.['successor-version']
      const predecessor = versionData._links?.['predecessor-version']
      const supersededBy = versionData._links?.['']
      const superseded = versionData._links?.['superseded']
      const supersedes = versionData._links?.['supersedes']
      if (successor) {
        console.log(versionData.title, "successor ", successor)
      }
      if (predecessor ) {
        console.log(versionData.title, "superseded  ", predecessor)
      }
      if (superseded) {
        console.log(versionData.title, "superseded  ", successor)
      }
      if (supersededBy) {
        console.log(versionData.title, "supersededBy  ", supersededBy)
      }
      if (supersedes) {
        console.log(versionData.title, "supersedes ", supersedes)
      }
      */


      const versionEntry = { // the minimum info to show the list of versions, use url to get the full data when 
        title: versionData.title,
        status: versionData.status,
        date: versionData.date,
        // additional properties
        url: versionUrl,
        statusOrder: getStatusOrder(versionData.status),
        isOutdated: versionData._links?.['successor-version']
      }

      versionEntries.push(versionEntry);

      if (versionUrl === latestVersionUrl) {
        latestVersionEntry = versionEntries[versionEntries.length - 1];
      }
    }

    if (!latestVersionEntry) {
      console.log(`  [Error] No latest version data found for href: ${latestVersionUrl}, skipping`);
      continue;
    }

    specsMap.set(specUrl, {  // set the minal info to specsMap, use url to get the full data when needed
      url: specUrl,
      title: specData.title,
      latestStatus: latestVersionEntry.status,
      latestDate: latestVersionEntry.date,
      versionEntries: versionEntries,
      statusOrder: getStatusOrder(latestVersionEntry.status)
    })

    // save the latest version data to each status map
    // fyi: https://www.w3.org/standards/types/
    // https://www.w3.org/TR/?filter-tr-name=&status%5B%5D=standard
    switch (latestVersionEntry.status) {
      case 'Recommendation':
        recommendations.push(latestVersionEntry);
        break;
      case 'First Public Working Draft':
        draftStandards.push(latestVersionEntry);
        break;
      case 'Working Draft':
        draftStandards.push(latestVersionEntry);
        break;
      case 'Last Call Working Draft':
        draftStandards.push(latestVersionEntry);
        break;
      case 'Proposed Recommendation':
        candidateRecommendations.push(latestVersionEntry);
        break;
      case 'Candidate Recommendation Draft':
        candidateRecommendations.push(latestVersionEntry);
        break;
      case 'Candidate Recommendation':
        candidateRecommendations.push(latestVersionEntry);
        break;
      case 'Candidate Recommendation Snapshot':
        candidateRecommendations.push(latestVersionEntry);
        break;
      case 'Statement':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Note':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Draft Note':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Registry':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Candidate Registry':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Registry':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Draft Registry':
        otherSpecs.push(latestVersionEntry);
        break;
      case 'Retired':
        retiredSpecs.push(latestVersionEntry);
        break;
      default:
        console.log('  [Info] Specification with other status found:', latestVersionEntry.status, 'for latestVersionUrl', latestVersionUrl);
        otherSpecs.push(latestVersionEntry);
        break
    }
    allVersions.push(...versionEntries);
  }
  const ret = {
    specsMap,
    recommendations,
    candidateRecommendations,
    draftStandards,
    retiredSpecs,
    otherSpecs,
    allVersions
  };
  return ret;
}



// グループごとの集計情報を取得
function extractGroupInfo(group) {
  const name = group.title || group.name || 'Unknown Group';
  const groupType = group.groupType || 'unknown';
  // グループ詳細
  const groupDetail = getDataEntry(group.href);

  const shortname = groupDetail?.shortname;
  const homepage = groupDetail?._links?.homepage?.href;

  let isIndivisualParticipationGroup = false;
  const participationsUrl = groupDetail?._links?.participations?.href;
  const usersUrl = groupDetail?._links?.users?.href;
  const specificationsUrl = groupDetail?._links?.specifications?.href;
  let membersMap = new Map();
  let memberParticipantsMap = new Map();
  let individualsMap = new Map();
  let invitedExpertsMap = new Map();
  let staffsMap = new Map();

  // specifications関連のMap
  let specsMap = new Map();
  let recommendations = [];
  let candidateRecommendations = [];
  let draftStandards = [];
  let retiredSpecs = [];
  let otherSpecs = [];
  let allVersions = [];

  if (participationsUrl) {
    ({
      membersMap,
      memberParticipantsMap,
      individualsMap,
      invitedExpertsMap,
      staffsMap
    } = getParticipationsClassificationMaps(groupType, shortname, participationsUrl));
  } else if (usersUrl) {
    isIndivisualParticipationGroup = true;
    ({
      membersMap,
      memberParticipantsMap,
      individualsMap,
      invitedExpertsMap,
      staffsMap
    } = getUsersClassificationMaps(groupType, shortname, usersUrl));
  }

  // Participants = memberParticipants + Invited Experts + Individuals + Staffs（重複許容）
  const allParticipantsArray = [
    ...memberParticipantsMap.values(),
    ...invitedExpertsMap.values(),
    ...staffsMap.values(),
    ...individualsMap.values(),
  ];

  if (specificationsUrl) {
    const specificationsDataEntry = getDataEntry(specificationsUrl);
    if (!specificationsDataEntry || !Array.isArray(specificationsDataEntry._links?.specifications)) {
      console.log('Warning: No specification array found specificationsUrl:', specificationsUrl);
    } else {
      const specificationsArray = specificationsDataEntry._links?.specifications
      const specResult = getSpecificationsClassificationMaps(groupType, specificationsArray);
      if (specResult) {
        ({
          specsMap,
          recommendations,
          candidateRecommendations,
          draftStandards,
          retiredSpecs,
          otherSpecs,
          allVersions
        } = specResult);
      }
    }
  }

  const groupInfo = new GroupInfo({
    name,
    shortname,
    groupType,
    homepage: homepage,
    // participations
    membersMap: membersMap,
    memberParticipants: Array.from(memberParticipantsMap.values()),
    invitedExperts: Array.from(invitedExpertsMap.values()),
    individuals: Array.from(individualsMap.values()),
    staffs: Array.from(staffsMap.values()),
    allParticipants: allParticipantsArray,
    isException: isIndivisualParticipationGroup,  // some IGs, task forces and other groups, e.g. ab.
    // specs
    specsMap: specsMap,
    recommendations: recommendations,
    candidateRecommendations: candidateRecommendations,
    draftStandards: draftStandards,
    retiredSpecs: retiredSpecs,
    otherSpecs: otherSpecs,
    allVersions: allVersions
  });
  return groupInfo;
}

function createAllParticipationsMapsFromGroupsMaps(groups) {
  // 全体統計を計算（重複を除く）
  const gpMembersMap = new Map();
  const gpMemberParticipantsMap = new Map();
  const gpInvitedExpertsMap = new Map();
  const gpStaffsMap = new Map();
  let gpIndividualsMap = new Map();
  const gpParticipantsMap = new Map()

  groups.forEach(group => {
    const shortname = group.shortname;
    // Members
    if (group.membersMap) {
      for (const [affUrl, affData] of group.membersMap) {
        for (const participant of affData.participants) {
          const affEntry = {
            href: affUrl,
            title: affData.title
          }
          addParticipantToMembersMap(shortname, affEntry, participant, gpMembersMap);
        }
      }
    }
    if (group.memberParticipants) addParticipantsArrayToMap(group.memberParticipants, gpMemberParticipantsMap);
    if (group.invitedExperts) addParticipantsArrayToMap(group.invitedExperts, gpInvitedExpertsMap);
    if (group.staffs) addParticipantsArrayToMap(group.staffs, gpStaffsMap);
    if (group.individuals) addParticipantsArrayToMap(group.individuals, gpIndividualsMap);
    if (group.allParticipants) addParticipantsArrayToMap(group.allParticipants, gpParticipantsMap);
  });

  // exclude gpInvitedExperts from gpIndivusuals 
  const gpInvitedExpertsAndIndivisualsMap = new Map([...gpIndividualsMap].filter(([key]) => gpInvitedExpertsMap.has(key))); // for debug
  gpIndividualsMap = new Map([...gpIndividualsMap].filter(([key]) => !gpInvitedExpertsMap.has(key)));
  console.log(`Info: Exclude Invited Experts who participate any group participates from participatting indivisuals=${gpInvitedExpertsAndIndivisualsMap.size}`);
  // 重複チェック
  checkOverlapParticipants(gpParticipantsMap, gpMemberParticipantsMap, gpInvitedExpertsMap, gpStaffsMap, gpIndividualsMap);

  return {
    gpMembersMap,
    gpMemberParticipantsMap,
    gpInvitedExpertsMap,
    gpIndividualsMap,
    gpStaffsMap,
    gpParticipantsMap
  }
}

/*
as of Feb 22, 2026


Groups (G): 285
Members (M): 290
Member Participants (MP): 3360
Invited Experts (IE): 387
Staffs (S): 44
Individuals (Ind): 9934
Participants (P): 13725

Groups (G): 285
Members (M): 335
Member Participants (MP): 7461
Invited Experts (IE): 388
Staffs (S): 53
Individuals (Ind): 29925
Participants (P): 37827

*/

function createSummaryOfParticipations(groupsArray) {
  // create group Participations(gp) using groups
  const {
    gpMembersMap,
    gpMemberParticipantsMap,
    gpInvitedExpertsMap,
    gpIndividualsMap,
    gpStaffsMap,
    gpParticipantsMap
  } = createAllParticipationsMapsFromGroupsMaps(groupsArray);

  // deepCopy gpMembersMap to gpMembersFromGroupsMap who contains only group participants
  const gpMembersFromGroupsMap = new Map(
    [...gpMembersMap].map(([k, v]) => [k, structuredClone(v)])
  );

  // create non group participations(ngp) using affilications
  const ngpMembersMap = new Map();
  const ngpMemberParticipantsMap = new Map();
  const ngpInvitedExpertsMap = new Map();
  let ngpIndivisualsMap = new Map();
  const ngpStaffsMap = new Map();

  const allAffEntry = getDataEntry('https://api.w3.org/affiliations/');
  if (!allAffEntry || allAffEntry.length === 0) {
    console.error('Error: cannot get affilications');
    return undefined
  }

  const afflications = allAffEntry._links?.affiliations || [];
  for (const affEntry of afflications) {
    const participantsArray = [];
    const affData = getDataEntry(affEntry.href);
    const affName = affData?.name || 'Unknown';
    if (affName == 'W3C Invited Experts') {
      console.log("Debug: createSummaryOfParticipations() W3C Invited Experts");
    }
    if (affData) {
      const participantsHref = affData._links?.participants?.href;
      if (participantsHref) {
        const participantsData = getDataEntry(participantsHref);  // // participatonsの場合はaffiliationsは一つだけ
        let participantItems = participantsData?._links?.participants || [];
        if (participantItems && typeof participantItems === 'object' && !Array.isArray(participantItems)) {
          participantItems = Object.values(participantItems);
        }
        for (const pItem of participantItems) {
          const { participant, memberAffiliation } = makeParticipant(pItem)
          participantsArray.push(participant);
        }
      }
    }
    if (affData == undefined) {
      continue;
    }

    if (affData['is-member'] == true) {
      let affHref = affEntry.href;
      let memberMap;
      if (!gpMembersMap.has(affHref)) {
        if (!ngpMembersMap.has(affHref)) {
          console.log("no partificatition affilication", affName);
        }
        memberMap = ngpMembersMap;
      } else {
        memberMap = gpMembersMap;
      }
      for (const participant of participantsArray) {
        const userHref = participant.userHref;
        if (!gpMemberParticipantsMap.has(userHref)) {
          // add participatants from members who are not participate any groups

          addParticipantToMembersMap(undefined, affEntry, participant, memberMap, true);   // isNoGroupParticipants=true
          addParticipantToMap(participant, ngpMemberParticipantsMap, true);     // isNoGroupParticipants=true
        }
      }
    } else {
      // non members
      if (affData.name == 'W3C') {
        for (const participant of participantsArray) {
          const userHref = participant.userHref;
          if (!gpStaffsMap.has(userHref)) {
            addParticipantToMap(participant, ngpStaffsMap, true);  // isNoGroupParticipants=true
          }
        }
      } else if (affData.name == 'W3C Invited Experts') {
        for (const participant of participantsArray) {
          const userHref = participant.userHref;
          if (!gpInvitedExpertsMap.has(userHref)) {
            addParticipantToMap(participant, ngpInvitedExpertsMap, true); //isNoGroupParticipants=true
          }
        }
      } else {  // non member affilications
        for (const participant of participantsArray) {
          const userHref = participant.userHref;
          if (!gpIndividualsMap.has(userHref)) {  // not indivusuals not in groups
            if (!gpInvitedExpertsMap.has(userHref)) {  // exclude Invited invitedExperts who has its affilications, it should not be categolized indivusals
              addParticipantToMap(participant, ngpIndivisualsMap, true);  // isNoGroupParticipants=true
            }
          }
        }
      }
    }
  }

  // exclude ngpInvitedExperts from ngpIndivusuals 
  const ngpInvitedExpertsAndIndivisualsMap = new Map([...ngpIndivisualsMap].filter(([key]) => ngpInvitedExpertsMap.has(key))); // for debug
  ngpIndivisualsMap = new Map([...ngpIndivisualsMap].filter(([key]) => !ngpInvitedExpertsMap.has(key)));
  console.log(`Info: Exclude Invited Experts who do not join any group participates from non participatting indivisuals=${ngpInvitedExpertsAndIndivisualsMap.size}`);

  // add indivisuals who do not belong to any affilications
  const noAffilicationIndivisualsMap = new Map();
  for (const [userHref, user] of gpIndividualsMap) {
    if (!ngpIndivisualsMap.has(userHref)) {
      noAffilicationIndivisualsMap.set(userHref, user)
    }
  }
  for (const [userHref, user] of noAffilicationIndivisualsMap) {
    ngpIndivisualsMap.set(userHref, user);
  }

  if (ngpInvitedExpertsMap.size > 0) {
    console.warn(`Warning: no group participating Invited experts exist ngpInvitedExpoertsMap.size=${ngpInvitedExpertsMap.size}`);
    let i = 0;
    for (const [_, entry] of ngpInvitedExpertsMap) {
      console.warn(i, entry.name);
      i++;
    }
    // ngpInvitedExpertsMap.clear(); // clear
  }

  // make allParticipants
  const ngpParticipantsMap = new Map([...ngpMemberParticipantsMap, ...ngpInvitedExpertsMap, ...ngpStaffsMap, ...ngpIndivisualsMap]);

  const allMembersMap = new Map([...gpMembersMap, ...ngpMembersMap]);
  const allMemberParticipantsMap = new Map([...gpMemberParticipantsMap, ...ngpMemberParticipantsMap]);
  const allInvitedExpertsMap = new Map([...gpInvitedExpertsMap, ...ngpInvitedExpertsMap]);
  const allStaffsMap = new Map([...gpStaffsMap, ...ngpStaffsMap]);
  const allIndividualsMap = new Map([...gpIndividualsMap, ...ngpIndivisualsMap]);
  const allParticipantsMap = new Map([...gpParticipantsMap, ...ngpParticipantsMap]);

  const countAllParticipants = allMemberParticipantsMap.size + allInvitedExpertsMap.size + allStaffsMap.size + allIndividualsMap.size;
  if (countAllParticipants != allParticipantsMap.size) {
    console.error("Error: countAllParticipants", countAllParticipants, allParticipantsMap.size);
    const participantsMap = new Map([...allMemberParticipantsMap, ...allInvitedExpertsMap, ...allStaffsMap, ...allIndividualsMap]);
    for (const [key, value] of participantsMap) {
      if (!allParticipantsMap.has(key)) {
        console.error("Error: not found in allParticipantsMap", key, value.name);
      }
    }
  }

  // 重複チェック
  checkOverlapParticipants(allParticipantsMap, allMemberParticipantsMap, allInvitedExpertsMap, allStaffsMap, allIndividualsMap);

  const summaryOfParticipationsFromGroups = {
    // participations
    membersMap: gpMembersFromGroupsMap, // only group participating member participants are included in the membersMap.
    memberParticipants: Array.from(gpMemberParticipantsMap.values()),  // from Groups
    invitedExperts: Array.from(gpInvitedExpertsMap.values()),
    individuals: Array.from(gpIndividualsMap.values()),
    staffs: Array.from(gpStaffsMap.values()),
    allParticipants: Array.from(gpParticipantsMap.values()),
    isException: false,  // some IGs, task forces and other groups, e.g. ab.
  }

  const summaryOfParticipations = {
    // participations
    membersMap: allMembersMap,
    memberParticipants: Array.from(allMemberParticipantsMap.values()),
    invitedExperts: Array.from(allInvitedExpertsMap.values()),
    individuals: Array.from(allIndividualsMap.values()),
    staffs: Array.from(allStaffsMap.values()),
    allParticipants: Array.from(allParticipantsMap.values()),
    isException: false,  // some IGs, task forces and other groups, e.g. ab.
  }

  return { summaryOfParticipations, summaryOfParticipationsFromGroups };
}

function createSummaryOfSpecifications() {
  // specifications関連のMap
  let specsMap = new Map();
  let recommendations = [];
  let candidateRecommendations = [];
  let draftStandards = [];
  let retiredSpecs = [];
  let otherSpecs = [];
  let allVersions = [];

  const allSpecEntry = getDataEntry('https://api.w3.org/specifications/');
  if (!allSpecEntry || allSpecEntry.length === 0) {
    return undefined
  }

  const specificationsArray = allSpecEntry._links?.specifications || []
  if (!specificationsArray || specificationsArray.length === 0) {
    console.log('  [Warning] No specifications found in all specifications entry');
    return undefined
  }

  const groupType = undefined;
  const specResult = getSpecificationsClassificationMaps(groupType, specificationsArray);
  if (specResult) {
    specsMap = specResult.specsMap
    recommendations.push(...specResult.recommendations);
    candidateRecommendations.push(...specResult.candidateRecommendations);
    draftStandards.push(...specResult.draftStandards);
    retiredSpecs.push(...specResult.retiredSpecs);
    otherSpecs.push(...specResult.otherSpecs);
    allVersions.push(...specResult.allVersions);
  }

  return {
    // specifications
    specsMap: specsMap,
    recommendations: recommendations,
    candidateRecommendations: candidateRecommendations,
    draftStandards: draftStandards,
    retiredSpecs: retiredSpecs,
    otherSpecs: otherSpecs,
    allVersions: allVersions
  }
}

function checkOverlapParticipants(allParticipantsMap, allMemberParticipantsMap, allInvitedExpertsMap, allStaffsMap, allIndividualsMap) {
  const allParticipantsCount = allMemberParticipantsMap.size + allInvitedExpertsMap.size + allStaffsMap.size + allIndividualsMap.size
  console.log(`  Info: Summary allParticipantsCount=${allParticipantsCount}, allParticipantsMap.size=${allParticipantsMap.size}`);
  if (allParticipantsCount !== allParticipantsMap.size) {
    console.error(`  Error: Summary count mismatch! allParticipantsCount=${allParticipantsCount}, allParticipantsMap.size=${allParticipantsMap.size}`);

  }

  let errorCount = 0;
  const mergedMap = new Map([
    ...allMemberParticipantsMap.entries(),
    ...allInvitedExpertsMap.entries(),
    ...allStaffsMap.entries(),
    ...allIndividualsMap.entries()
  ]);
  console.log(`  Info: Summary mergedMap.size=${mergedMap.size}`);
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
        errorCount++;
        console.log(`  Error: Overlap found between maps #${i} and #${j}: size=${diff.size}`);
        for (const [key, value] of diff.entries()) {
          console.log(`    Overlap name: ${value.name}, userHref: ${value.userHref}`);
        }
      }
    }
  }
  if (errorCount > 0) {
    console.error("checkOverlapParticipants NG", errorCount);
    throw new Error("checkOverlapParticipants NG");
  } else {
    console.log("checkOverlapParticipants OK");
  }
}


function makeParticipant(user) {
  let userHref = user.href;
  let userName = user.title;
  let numGroups = 0;

  const userData = getDataEntry(userHref);
  if (userData) {
    const groupsHref = userData?._links?.groups?.href;
    if (groupsHref) {
      const groupsData = getDataEntry(groupsHref);
      let groupsArray = groupsData?._links?.groups || [];
      if (Array.isArray(groupsArray)) {
        numGroups = Object.values(groupsArray).length;
      }
    }
  }
  const afflicationsHref = userData?._links?.affiliations?.href;
  const { partType, memberAffiliation } = checkAffiliations(userName, afflicationsHref);

  const participant = {
    userHref: userHref,
    name: userName,
    numGroups: numGroups,
    partType: partType
  };

  return { participant, memberAffiliation }
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

function addParticipantToMap(participant, map, isNoGroupParticipant = false) {
  if (isNoGroupParticipant) {
    delete participant.numGroups;  // if isNoGroupparticipant is true, the participant must not have numGroups
  } else {
    if (!Object(participant).hasOwnProperty('numGroups')) { // if no numGroups
      participant.numGroups = 0;      // add numGroups for groupParticipatans just in case it doex not exist
    }
  }

  map.set(participant.userHref, participant);
}

function addParticipantsArrayToMembersMap(shortName, memberAffiliation, participantsArray, membersMap) {
  for (const participant of participantsArray) {
    addParticipantToMembersMap(shortName, memberAffiliation, participant, membersMap);
  }
}

function addParticipantToMembersMap(shortname, memberAffiliation, participant, map, isNoGroupParticipant = false) {
  const affUrl = memberAffiliation.href;
  const affTitle = memberAffiliation.title;
  try {
    if (isNoGroupParticipant) {
      delete participant.numGroups;  // if noGroupparticipant is true, the participant must not have numGroups
    }
    // mapの値は必ず配列である前提で、orgUrlごとにparticipantを重複なく追加
    if (!map.has(affUrl)) {
      const value = {
        affUrl: affUrl,
        // id: should add id
        title: affTitle,
        participants: [participant]
      }
      if (!isNoGroupParticipant && shortname) {
        value.groupsSet = new Set([shortname])   // only groupParticipant member has groups
      }
      map.set(affUrl, value);
    } else {
      const affData = map.get(affUrl);
      if (!isNoGroupParticipant && shortname && Object(affData).hasOwnProperty('groupsSet')) {
        affData.groupsSet.add(shortname);   // only groupParticipant member has groups
      }
      if (!affData.participants.some(p => p.userHref === participant.userHref)) {
        affData.participants.push(participant);
      }
    }
  } catch (e) {
    console.log(e);
  }
}

// create the statsTimelineData to make it easier to draw timeline graph, and also make diffs of MP and P.
function createStatsTimeline() {
  let _metadata = undefined;
  const timestamps = [];
  const seriesMap = new Map();

  const timelineData = globalApiData.timelineData;
  if (timelineData) {
    // find all groups, all stats, all members in the timeline
    const groupsSet = new Set();
    const statsSet = new Set();
    for (const [eventKey, eventValue] of Object.entries(timelineData)) {
      if (eventKey == '_metadata') {
        continue;
      } else {
        const groups = Object.keys(eventValue.eventData.groups || {});
        for (const groupId of groups) {
          {
            groupsSet.add(groupId);
            const stats = Object.keys(eventValue.eventData.groups?.[groupId]?.stats || {});
            for (const statId of stats) {
              statsSet.add(statId);
            }
          }
        }
      }
    }

    // make timestamps and seriesMap for all groups and all stats(M, MP, etc.)
    for (const [eventKey, eventValue] of Object.entries(timelineData)) {
      if (eventKey == '_metadata') {
        _metadata = eventValue;
      } else {
        const timestamp = Number(eventKey)
        timestamps.push(timestamp);   // key is a timestamp of event

        // add summary stats to SeriesMap
        const statsForSummary = eventValue.eventData.summary.stats;
        const diffForSummary = eventValue.eventData.summary.diff;
        addGroupStatsToSeriesMap(seriesMap, statsSet, "summary", statsForSummary, diffForSummary, false);

        // add summary only group participations related stats
        const statsForSummaryOnlyGroupParticipations = eventValue.eventData.summary.onlyGroupParticipationsStats;
        // user summary diff because onlyGroupParticipations=true makes diff for OnlyGroupParticipations from summary diff
        addGroupStatsToSeriesMap(seriesMap, statsSet, "summaryOnlyGroupParticipations", statsForSummaryOnlyGroupParticipations, diffForSummary, true);
        // add all stats for each group to SeriesMap
        for (const groupId of groupsSet) {  // all groups
          let statsForGroup = eventValue.eventData.groups?.[groupId]?.stats;
          let diffForGroup = eventValue.eventData.groups?.[groupId]?.diff;
          /*
          if ((timestamp == 1768721659000 || timestamp >= 1769326645000) && groupId == "web-networks") {   // last stat is at 1768721659000 Sun, 18 Jan 2026 07:34:19 GMT, no stat is at 1769326645000
            console.log("debug web-network", timestamp, groupId, eventValue.eventTime);
            console.log("statsForGroup", JSON.stringify(statsForGroup));
            console.log("diffForGroup", JSON.stringify(diffForGroup))
          }
            */
          /* This is for debug, makes a gap of line at 2026/3/15(1773567044000)
          if (timestamp == 1773567044000 && groupId == "social") {  // socal web working group started at 1773567044000(2026/1/18)
            console.log(timestamp, groupId);
            console.log("statsForGroup", JSON.stringify(statsForGroup));
            console.log("diffForGroup", JSON.stringify(diffForGroup))
            statsForGroup = undefined;
            diffForGroup = undefined;
          }
          */
          addGroupStatsToSeriesMap(seriesMap, statsSet, groupId, statsForGroup, diffForGroup, false);
        }
      }
    }
  }

  const statsTimeline = {
    _metadata,
    timestamps,
    seriesMap
  }
  return statsTimeline
}

function addGroupStatsToSeriesMap(seriesMap, statsSet, groupId, groupStats, groupDiff, onlyGroupParticipations = false) {
  function _addStatToSeriesMap(seriesMap, groupId, statId, value, diff) {
    let statsMap = seriesMap.get(groupId);
    if (!statsMap) {
      statsMap = new Map();
      seriesMap.set(groupId, statsMap);
    }
    let values = statsMap.get(statId);
    if (!values) {
      values = [];
      statsMap.set(statId, values);
    }
    const data = {
      value: value,
      diff: diff
    }
    values.push(data);
  }

  // make stats for StatsSet except P  
  const diffDict = {};  // save diffs to make P diff from other diffs
  for (const statId of statsSet) {  // all stats
    if (statId == 'P') {
      continue;  // skip P to make it latter.
    }
    const stat = groupStats?.[statId];
    let diff = statId === 'MP' ? makeMergedDiff(groupDiff?.['MPs']) : // use 'MPs' to to make 'MP' of diff
      groupDiff?.[statId];
    if (onlyGroupParticipations) {
      diff = makeDiffOfOnlyGroupParticipations(diff);  // diff of only group participation
    }
    _addStatToSeriesMap(seriesMap, groupId, statId, stat, diff);
    diffDict[statId] = diff;  // for making P diff
  }

  // make P diff from other diffs because P diff is not provided in the API, and it is needed to calculate the diff of only group participations related P by makeDiffOfFromDiffOfOthers() which requires diff of MP, IE, S and Ind.  
  const statP = groupStats?.['P'];
  const diffP = makeMergedDiff([diffDict.MP, diffDict.IE, diffDict.S, diffDict.Ind]);
  _addStatToSeriesMap(seriesMap, groupId, 'P', statP, diffP);
}

function makeMergedDiff(diffArray) {
  if (!diffArray) {
    return undefined;  // no diffArray      
  }
  if (!Array.isArray(diffArray)) {
    console.error("Error: makeMergedDiff() diffArray is not an array, cannot merge diffs");
    return undefined;
  }
  const diffPlus = [];
  const diffMinus = [];
  const diffChanged = [];
  for (const diffM of diffArray) {
    if (!diffM) {
      continue;  // no diff for this stat, skip
    }
    if (Object(diffM).hasOwnProperty('+')) {
      for (const item of diffM['+']) {
        diffPlus.push(item);
      }
    }
    if (Object(diffM).hasOwnProperty('~')) { // changed Group participation, e.g. from non group participant to group participant, or vice versa, or change the number of group participations.
      for (const item of diffM['~']) {
        diffChanged.push(item);
      }
    }
    if (Object(diffM).hasOwnProperty('-')) {
      for (const item of diffM['-']) {
        diffMinus.push(item);
      }
    }
  }
  const diff = {};
  if (diffPlus.length != 0) {
    diff['+'] = diffPlus;
  }
  if (diffChanged.length != 0) {
    diff['~'] = diffChanged;
  }
  if (diffMinus.length != 0) {
    diff['-'] = diffMinus;
  }
  return Object.keys(diff).length > 0 ? diff : undefined;  // if diff is empty, return undefined
}

function makeDiffOfOnlyGroupParticipations(diff) {
  const onlyGroupParticipationsDiff = {};
  const diffPlus = [];
  const diffMinus = [];
  if (Object(diff).hasOwnProperty('+')) {
    for (const item of diff['+']) {
      if (Object(item).hasOwnProperty('G')) {
        diffPlus.push(item);  // only group participation added
      }
    }
  }

  if (Object(diff).hasOwnProperty('~')) { // changed Group participation, e.g. from non group participant to group participant, or vice versa, or change the number of group participations.
    for (const item of diff['~']) {
      if (Object(item).hasOwnProperty('G')) {
        diffPlus.push(item);  // non group participant -> group participant
      } else {
        diffMinus.push(item); // group participant -> non group participant  
      }
    }
  }

  if (Object(diff).hasOwnProperty('-')) {
    for (const item of diff['-']) {
      if (Object(item).hasOwnProperty('G')) {
        diffMinus.push(item);  // only group participation removed
      }
    }
  }

  if (diffPlus.length != 0) {
    onlyGroupParticipationsDiff['+'] = diffPlus;
  }
  if (diffMinus.length != 0) {
    onlyGroupParticipationsDiff['-'] = diffMinus;
  }
  // no '~' diff because it is included in '+' or '-' for only group participations

  return Object.keys(onlyGroupParticipationsDiff).length > 0 ? onlyGroupParticipationsDiff : undefined;  // if diff is empty, return undefined
}


// w3cStats情報を作成（メイン関数）
export function makeStats(apiData) {  // exportModule
  globalApiData = apiData;    // set globalApiData to use getDataEntry()

  const groups = extractGroups();

  const groupsArray = groups.map(group => extractGroupInfo(group));

  const { summaryOfParticipations, summaryOfParticipationsFromGroups } = createSummaryOfParticipations(groupsArray);
  if (!summaryOfParticipations || !summaryOfParticipationsFromGroups) {
    return undefined;
  }

  const summaryOfSpecifications = createSummaryOfSpecifications() // specifications

  const summaryGroup = new GroupInfo({
    name: 'Summary',
    shortname: 'summary',
    groupType: 'summary',
    homepage: 'https://www.w3.org/',
    ...summaryOfParticipations,
    ...summaryOfSpecifications
  });

  const onlyGroupParticipationsSummaryGroup = summaryOfParticipationsFromGroups ?
    new GroupInfo({
      name: 'Summary - Only Group Participations',
      shortname: 'summaryOnlyGroupParticipations',
      groupType: 'summary',
      homepage: 'https://www.w3.org/',
      ...summaryOfParticipationsFromGroups, // only group Participations
      ...summaryOfSpecifications
    }) : undefined;   // do not use onlyGroupparticipatsSummaryGroup

  const statsTimeline = createStatsTimeline();

  const w3cStats = {
    groupsArray,
    summaryGroup,
    onlyGroupParticipationsSummaryGroup,
    statsTimeline,
    lastChecked: globalApiData.mainData?._metadata.lastChecked  //mainData may not exist if makeStats() is used by fetch-w3c-data.js
  };
  return w3cStats;
}

export function makeGroupStats(groupInfo) { // if groupInfo is undefined, all values are zero.
  return {
    'M': groupInfo?.membersMap.size || 0,
    'MP': groupInfo?.memberParticipants.length || 0,
    'IE': groupInfo?.invitedExperts.length || 0,
    'S': groupInfo?.staffs.length || 0,
    'Ind': groupInfo?.individuals.length || 0,
    'P': groupInfo?.allParticipants.length || 0,
    'Spec': groupInfo?.specsMap.size || 0,
    'Rec': groupInfo?.recommendations.length || 0,
    'CR': groupInfo?.candidateRecommendations.length || 0,
    'DS': groupInfo?.draftStandards.length || 0,
    'Ret': groupInfo?.retiredSpecs.length || 0,
    'Oth': groupInfo?.otherSpecs.length || 0,
    'Ver': groupInfo?.allVersions.length || 0,
  }
}

function makeDiffOfParticipants(prevParticipants, eventParticipants) {  // eventParticipants is empty, {} if the group is closed. Just save all participatns of the closed group. prevParticipants is empty if the groups is opend, just save participatatns of the new groupsm
  const prevUsersMap = new Map(   /// prevParticipants may be {}
    prevParticipants.map(user => [user.userHref, user])
  );
  const eventUsersMap = new Map(
    eventParticipants.map(user => [user.userHref, user])
  );
  const allUsersUrls = Array.from(new Set([...prevUsersMap.keys(), ...eventUsersMap.keys()]));

  const joinedUsers = [];
  const leftUsers = [];
  const gpChangedUsers = [];
  for (const userUrl of allUsersUrls) {
    // do not save userHref to save the data, make id from it.
    const id = userUrl.split('/').pop();  // e.g. https://api.w3.org/users/t9e3254kg1cowcgw40owcw08w8wow0o

    if (eventUsersMap.has(userUrl)) {
      if (prevUsersMap.has(userUrl)) {
        // an existing user, if the group participation has no change, do not nothing, otherwise put in gpChangedUsers.
        const prevUser = prevUsersMap.get(userUrl);
        const eventUser = eventUsersMap.get(userUrl);
        const isPrevGroupPartipations = Object(prevUser).hasOwnProperty('numGroups');
        const isEventGroupPaticipations = Object(eventUser).hasOwnProperty('numGroups');
        if (isPrevGroupPartipations != isEventGroupPaticipations) { // changed
          const userInfo = {
            id: id,
            name: eventUser.name || 'Unknown'
          }
          if (Object(eventUser).hasOwnProperty('numGroups')) { // if group participant has numGroups, it has "G". Note numGroups may be zero for some who participats in task forces.
            userInfo.G = eventUser.numGroups;
          }
          gpChangedUsers.push(userInfo);
        }
      } else {
        // new user
        const user = eventUsersMap.get(userUrl);
        const userInfo = {
          id: id,
          name: user.name || 'Unknown'
        }
        if (Object(user).hasOwnProperty('numGroups')) { // if group participant has numGroups, it has "G". Note numGroups may be zero for some who participats in task forces.
          userInfo.G = user.numGroups;
        }
        joinedUsers.push(userInfo);
      }
    } else {
      if (prevUsersMap.has(userUrl)) {
        // left member
        const user = prevUsersMap.get(userUrl);
        const userInfo = {
          id: id,
          name: user.name || 'Unknown',
        }
        if (Object(user).hasOwnProperty('numGroups')) { // if group participant has numGroups, it has "G".
          userInfo.G = user.numGroups;
        }
        leftUsers.push(userInfo);
      } else {
        console.error("User is in neither event nor next userUrl=", userUrl)
      }
    }
  }
  const diff = {};
  if (joinedUsers.length > 0) diff['+'] = joinedUsers;
  if (leftUsers.length > 0) diff['-'] = leftUsers;
  if (gpChangedUsers.length > 0) diff['~'] = gpChangedUsers;

  return diff;
}

function makeDiffOfGroup(prevGroupInfo, eventGroupInfo) { //eventGroupInfo is undefined if the group is closed
  try {
    let MPs = [];
    const joinedMembers = [];
    const leftMembers = [];
    const gpChangedMembers = [];

    const prevMembersSet = new Set(prevGroupInfo ? prevGroupInfo.membersMap.keys() : []);
    const eventMembersSet = new Set(eventGroupInfo ? eventGroupInfo.membersMap.keys() : []);
    const allMemberUrls = Array.from(new Set([...prevMembersSet.keys(), ...eventMembersSet.keys()]));

    for (const memberUrl of allMemberUrls) {
      const id = memberUrl.split('/').pop();  // e.g. https://api.w3.org/affiliations/139511'{
      if (eventMembersSet.has(memberUrl)) {
        const eventMember = eventGroupInfo.membersMap.get(memberUrl);
        const eventParticipants = eventMember.participants;
        let prevParticipants = [];

        if (prevMembersSet.has(memberUrl)) {
          // an existing member 
          const prevMember = prevGroupInfo.membersMap.get(memberUrl);
          prevParticipants = prevMember.participants;

          const isPrevGroupParticipations = Object(prevMember).hasOwnProperty('groupsSet');
          const isEventGroupParticipations = Object(eventMember).hasOwnProperty('groupsSet');
          if (isPrevGroupParticipations != isEventGroupParticipations) { // groupParticipation changed
            const memberInfo = {
              id: id,
              title: eventMember.title || 'Unknown',
            }
            if (isEventGroupParticipations) {
              memberInfo.G = eventMember.groupsSet.size;
            }
            gpChangedMembers.push(memberInfo);
          }
        } else {
          // new member
          const memberInfo = {
            id: id,
            title: eventMember.title || 'Unknown'
          }
          if (Object(eventMember).hasOwnProperty('groupsSet')) {
            memberInfo.G = eventMember.groupsSet.size;
          }
          joinedMembers.push(memberInfo);
          // make diff with prevParticipants =[];
        }
        // for both existing and new members, compare members participants and save MP if there is diff
        const diff = makeDiffOfParticipants(prevParticipants, eventParticipants);
        if (Object.keys(diff).length > 0) {
          const mpInfo = {
            id: id,
            title: eventMember.title || 'Unknown',
            ...diff
          }
          MPs.push(mpInfo);
        }
      } else if (prevGroupInfo) {
        if (prevMembersSet.has(memberUrl)) {
          // left member
          const eventParticipants = [];
          const prevMember = prevGroupInfo.membersMap.get(memberUrl);
          const prevParticipants = prevMember.participants;
          // make diff with eventParticipnts = [];
          const diff = makeDiffOfParticipants(prevParticipants, eventParticipants);
          if (Object.keys(diff).length > 0) {
            const mpInfo = {
              id: id,
              title: prevMember.title || 'Unknown',
              ...diff
            }
            MPs.push(mpInfo);
          }
          const memberInfo = {
            id: id,
            title: prevMember.title || 'Unknown'
          }
          if (Object(prevMember).hasOwnProperty('groupsSet')) {
            memberInfo.G = prevMember.groupsSet.size;
          }
          leftMembers.push(memberInfo);
        } else {
          // there is a bug!
          console.error(`Error: member is not in neither event or nextEvent memberUrl=`, memberUrl);
          return undefined;
        }
      }
    }

    for (const [i, a] of Object.entries(joinedMembers)) {
      for (const [j, b] of Object.entries(joinedMembers)) {
        if (i != j && a.id == b.id) {
          console.error(`Error: makeDiffOfGroup ['+'] group=${eventGroupInfo.shortname}`, a.title, b.title);
        }
      }
    }

    for (const [i, a] of Object.entries(leftMembers)) {
      for (const [j, b] of Object.entries(leftMembers)) {
        if (i != j && a.id == b.id) {
          console.error(`Error: makeDiffOfGroup ['-'] group=${prevGroupInfo.shortname}`, a.title, b.title);
        }
      }
    }


    const M = {};
    if (joinedMembers.length > 0) {
      M['+'] = joinedMembers;
    }
    if (leftMembers.length > 0) {
      M['-'] = leftMembers;
    }
    if (gpChangedMembers.length > 0) {
      M['~'] = gpChangedMembers;
    }

    const IE = makeDiffOfParticipants(prevGroupInfo?.invitedExperts || [], eventGroupInfo?.invitedExperts || []);
    const S = makeDiffOfParticipants(prevGroupInfo?.staffs || [], eventGroupInfo?.staffs || []);
    const Ind = makeDiffOfParticipants(prevGroupInfo?.individuals || [], eventGroupInfo?.individuals || []);
    // No need to make P since it can be generated from MPs, IE, S and Indv.

    //  set properties
    const diff = {
      M,
      MPs, // MPs is an array of MP for each members
      IE,
      S,
      Ind
      // no P since P = MPs + IE + S + Ind
    };

    if (eventGroupInfo) {
      // check eventGroupInfo?.allParticipants if P = MPs + IE + S + Ind
      if (!checkAllParticipants(eventGroupInfo)) {
        console.error(`Error makeDiffOfGroup() checkAllParticipants error #${eventGroupInfo.shortname}`);
        return undefined;
      }
    }
    // check diff prevGroupInfo and eventGroupInfo. 
    if (prevGroupInfo) {
      const eventStats = eventGroupInfo ? makeGroupStats(eventGroupInfo) : undefined;  // Note eventGroupInfo is undefined if the group is closed
      const prevStats = makeGroupStats(prevGroupInfo);
      const groupData = {
        stats: eventStats,    // eventStats is undefined if the group is closed
        diff
      };
      const madePrevStats = makePrevGroupStats(groupData);
      if (!checkStats(prevStats, madePrevStats)) {
        console.error(`Error makeDiffOfGroup() checkStats error #${eventGroupInfo.shortname}`);
        console.error(`prevStats=${JSON.stringify(prevStats)}`);
        console.error(`madePrevStats=${JSON.stringify(madePrevStats)}`);
        console.error(`eventStats=${JSON.stringify(eventStats)}`);
        console.error(`diff=${JSON.stringify(diff)}`);

        return undefined;
      }
    }
    // if OK, return 
    return diff;;
  } catch (e) {
    console.error(e);
    throw (e);
  }

}

function checkAllParticipants(eventGroupInfo, isOnlyGroupParticipations = false) {
  const allMPs = Array.from(eventGroupInfo.membersMap.keys()).map(memberUrl => {
    const member = eventGroupInfo.membersMap.get(memberUrl);
    return member.participants;
  }).flat();

  const allParticipants = allMPs.concat(
    eventGroupInfo.invitedExperts,
    eventGroupInfo.staffs,
    eventGroupInfo.individuals
  );

  // check dupplication in allParticipants
  const userSet = new Set();
  const duplicateUsers = [];
  for (const user of allParticipants) {
    const userHref = user.userHref;
    if (userSet.has(userHref)) {
      console.error(`Error checkAllParticipants() duplicate participant in allParticipants #${eventGroupInfo.shortname}, user=${JSON.stringify(user)}`);
      duplicateUsers.push(user);
    }
    userSet.add(userHref);
  }
  if (duplicateUsers.length > 0) {
    console.error(`Error checkAllParticipants() duplicate participant count=${duplicateUsers.length} #${eventGroupInfo.shortname}`);
    return false;
  }

  // check dupplications in allMPs, invitedExperts, staffs and indivisuals
  const mpSet = new Set(allMPs.map(user => user.userHref));
  const ieSet = new Set(eventGroupInfo.invitedExperts.map(user => user.userHref));
  const sSet = new Set(eventGroupInfo.staffs.map(user => user.userHref));
  const indSet = new Set(eventGroupInfo.individuals.map(user => user.userHref));

  if (mpSet.size != allMPs.length) {
    console.error(`Error checkAllParticipants() duplicate MPs in #${eventGroupInfo.shortname}`);
    return false;
  }

  const count = 0;
  for (const user of allMPs) {
    const userHref = user.userHref;
    if (ieSet.has(userHref)) {
      console.error(`Error checkAllParticipants() participant overlap in MPs and IE #${eventGroupInfo.shortname}, user=${JSON.stringify(user)}`);
      count++
    }
    if (sSet.has(userHref)) {
      console.error(`Error checkAllParticipants() participant overlap in MPs and S #${eventGroupInfo.shortname}, user=${JSON.stringify(user)}`);
      count++
    }
    if (indSet.has(userHref)) {
      console.error(`Error checkAllParticipants() participant overlap in MPs and Ind #${eventGroupInfo.shortname}, user=${JSON.stringify(user)}`);
      count++
    }
  }
  if (count > 0) {
    console.error(`ErrorcheckAllParticipants() participant overlap count=${count} #${eventGroupInfo.shortname}`);
    return false;
  }

  // check total of participants consistent with MP, IE staff, Indivisuals.
  const allParticipantKeys = Array.from(new Set([...mpSet, ...ieSet, ...sSet, ...indSet]));
  if (allParticipantKeys.length !== eventGroupInfo.allParticipants.length) {
    console.error(`Error checkAllParticipants() allParticipants count mismatch #${eventGroupInfo.shortname}`);
    console.error(`allParticipantKeys.length=${allParticipantKeys.length}, eventGroupInfo.allParticipants.length=${eventGroupInfo.allParticipants.length}`);
    console.error(`mpSet.size=${mpSet.size}`);
    console.error(`ieSet.size=${ieSet.size}`);
    console.error(`sSet.size=${sSet.size}`);
    console.error(`indSet.size=${indSet.size}`);
    console.error(`total=${mpSet.size + ieSet.size + sSet.size + indSet.size}`);
    return false
  }
  return true
}

function makeGroupsMap(groupsArray) { // map key is shortname
  const groupsMap = new Map();
  // all groups
  for (const groupInfo of groupsArray) {
    const shortname = groupInfo.shortname;
    if (shortname == undefined) {
      // groupDetails is not avaiable. it can not make groupStat anyway/
      continue;
    }
    groupsMap.set(shortname, groupInfo);
  }
  return groupsMap
}

/*
makeTimelineEventData
  With the current group list(userUrl), past participants can be reconstructed using diffs.
For closed groups, this is not possible, so their participation data is saved when the group is closed.
Because group closures are rare, this helps keep the timeline data small.
In theory, past event stats could be calculated from diffs if the current stats are available, 
but we store the stats at each event explicitly.
*/
export function makeTimelineEventData(prevTimestamp, prevStats, eventTimestamp, eventStats) { // prevStats is undefined if no previousStats

  console.log(`  Info: makeTimelineEventData() eventTimestamp=${eventTimestamp}, ${new Date(eventTimestamp).toUTCString()}`);

  // check if groupParticipants in summaryOfGroupParticipations is consistent with groupsArray.
  if (!checkOnlyGroupParticipations(eventStats)) {
    console.error(`Error: makeTimelineEventData() checkOnlyGroupParticipations failed`);
    return undefined;
  }

  // summary
  const summaryStats = makeGroupStats(eventStats.summaryGroup);
  // prevTime, summaryDiff, and groups is set if prevStatus != undefined
  const summary = {
    stats: summaryStats
  }
  // onlyGroupParticipationsSummaryStats is set for summary of only group participations
  summary.onlyGroupParticipationsStats = makeGroupStats(eventStats.onlyGroupParticipationsSummaryGroup);
  // do not add diff of onlyGroupParticipationsSummaryStats because it can be generated from diff of summaryStats using the numGroups of a user

  if (prevStats) {
    const diff = makeDiffOfGroup(prevStats.summaryGroup, eventStats.summaryGroup);
    if (diff) {
      summary.diff = diff;
      /*
      * Note that the following are is for debug to check the diff and onlyGroupparticipationsStats
      */

      // check if the diff is consisent.  this should be true if checkOnlyGroupParticpants() is true.
      const prevSummaryStats = makeGroupStats(prevStats.summaryGroup);
      if (!checkDiffSummaryStats(prevSummaryStats, diff, summaryStats, false)) { // isOnlyGroupParticipations=false
        console.error(`Error: makeTimelineEventData() checkDiffSummaryStats isOnlyGroupParticipations=false failed`);
        dumpDiffOfOnlyGroupParticipationsSummaryStats(prevStats, eventStats);  // dump diff of onlyGroupParticipationsSummaryStats for debug
        return undefined;
      }
      // check if groupParticipants in summaryOfGroupParticipations is consistent with groupsArray.
      if (!checkOnlyGroupParticipations(prevStats)) {
        console.error(`Error: makeTimelineEventData() checkOnlyGroupParticipations for prevStats failed`);
        return undefined;
      }

      // check if summaryStatss of onlyGroupPartipations is consistent.
      const prevOnlyGroupParticipationsSummaryStats = makeGroupStats(prevStats.onlyGroupParticipationsSummaryGroup);
      if (!checkDiffSummaryStats(prevOnlyGroupParticipationsSummaryStats, diff, summary.onlyGroupParticipationsStats, true)) {  // isOnlyGroupParticiations=true
        console.error(`Error: makeTimelineEventData() heckDiffSummaryStats isOnlyGroupParticipations=false failed`);


        const prevMembersMap = prevStats.onlyGroupParticipationsSummaryGroup.membersMap;
        const membersMap = eventStats.onlyGroupParticipationsSummaryGroup.membersMap;

        const joinedMembersMap = new Map([
          ...[...membersMap].filter(([k]) => !prevMembersMap.has(k)),
        ]);

        const leftMembersMap = new Map([
          ...[...prevMembersMap].filter(([k]) => !membersMap.has(k)),
        ]);

        for (const [key, value] of joinedMembersMap) {
          if (prevMembersMap.has(key)) {
            console.log("join prev", key, value.title);
          }
          if (membersMap.has(key)) {
            console.log("join new", key, value.title);
          }
        }

        for (const [key, value] of leftMembersMap) {
          if (prevMembersMap.has(key)) {
            console.log("left prev", key, value.title);
          }
          if (membersMap.has(key)) {
            console.log("left new", key, value.title);
          }
        }

        dumpDiffOfOnlyGroupParticipationsSummaryStats(prevStats, eventStats);  // dump diff of onlyGroupParticipationsSummaryStats for debug
        return undefined;
      }
    }
  }

  const prevGroupsMap = prevStats ? makeGroupsMap(prevStats.groupsArray) : new Map();
  const eventGroupsMap = makeGroupsMap(eventStats.groupsArray);
  const allGroupsShortnames = Array.from(new Set([...prevGroupsMap.keys(), ...eventGroupsMap.keys()]));

  // make diff of groups and the diff members, membersParticipants, invited experts, staffs, and allparticipants of groups.
  const groups = {};
  for (const shortname of allGroupsShortnames) {
    if (eventGroupsMap.has(shortname)) {
      const eventGroupInfo = eventGroupsMap.get(shortname);
      const stats = makeGroupStats(eventGroupInfo);
      const name = eventGroupInfo.name;
      if (!prevStats) {
        // if no prevStats, save just stats regardless the groups is new or existing
        const groupData = {
          name, // group name
          stats, // stats of the existing group at this event
          // no diff
        }
        groups[shortname] = groupData;
      } else {
        // if prevStatus, save stats and diff. Note if stat has no change, diff is not saved
        let prevGroupInfo = undefined;
        if (prevGroupsMap.has(shortname)) {
          // an exisiting group, make DiffOfGroups with prevGroupInfo and eventGroup
          prevGroupInfo = prevGroupsMap.get(shortname);
        } else {
          console.log("  Info: makeTimelineEventData(), a new group:", shortname);
          // else new group makeDiffGroups with only eventGroups, prevGroupInfo == undefined
        }
        const diff = makeDiffOfGroup(prevGroupInfo, eventGroupInfo)
        const groupData = {
          name,   // group name
          stats,  // stats of the new and exisiting group at this event
          diff,   // a propety, eg. IE,  in diff is empty {} if no changes
        }
        groups[shortname] = groupData;
      }
    } else if (prevStats) {
      if (prevGroupsMap.has(shortname)) {
        console.log("  Info: makeTimelineEventData(), a closed group:", shortname);
        // a closed group, save only the diff to save the last participants of the group
        const prevGroupInfo = prevGroupsMap.get(shortname);
        const diff = makeDiffOfGroup(prevGroupInfo, undefined);
        const stats = makeGroupStats(undefined);  // all zero
        const name = prevGroupInfo.name;
        groups[shortname] = {
          name,   // group name
          stats,  // for the closed group, add stats with all zero to show the diff
          diff  //  but record diff to save the participants of the closed group in the previous Stats.
        }
      } else {
        // there is a bug!
        console.error(`Error: group ${shortname} is not either in prevGroup nor eventGroup.`);
      }
    }
  }

  const eventTime = new Date(eventTimestamp).toUTCString();
  const eventData = {
    [eventTimestamp]: {
      eventTime,  // this is for human, eventTime can be generated by the key of eventTimestamp
      prevTimestamp, // this is the key of the previousEvent, does not exist if prevStats == undefined
      eventData: {
        summary,
        groups,
      }
    }
  };
  return eventData;
}

function makeDiffPartcipantsMaps(diffData, isOnlyGroupParticipations = false) {
  let joinedItemsMap = new Map();
  let leftItemsMap = new Map();
  let gpJoinedItemsMap = new Map();
  let gpLeftItemsMap = new Map();

  if (diffData) {
    const joinedMembers = diffData['+'] ?? [];
    const leftMembers = diffData['-'] ?? [];
    const gpChangedMembers = diffData['~'] ?? [];
    for (const m of joinedMembers) {
      joinedItemsMap.set(m.id, m);
      if (Object(m).hasOwnProperty('G')) {
        gpJoinedItemsMap.set(m.id, m);
      }
    }
    for (const m of leftMembers) {
      leftItemsMap.set(m.id, m);
      if (Object(m).hasOwnProperty('G')) {
        gpLeftItemsMap.set(m.id, m);
      }
    }
    for (const m of gpChangedMembers) {
      if (Object(m).hasOwnProperty('G')) {
        gpJoinedItemsMap.set(m.id, m);
      } else {
        gpLeftItemsMap.set(m.id, m);
      }
    }
  }

  return isOnlyGroupParticipations ? [gpJoinedItemsMap, gpLeftItemsMap] :
    [joinedItemsMap, leftItemsMap];
}

function makePrevGroupStats(groupData, isOnlyGroupParticipations = false) {
  // if stats,　copy status of the groupData as the prev status, otherwise set 0 to all propeties of the prevStats
  const prevStats = groupData?.stats ? { ...groupData.stats } : makeGroupStats(undefined);

  if (groupData.diff) {
    for (const [statType, diffData] of Object.entries(groupData.diff)) {
      if (statType == 'MPs') { // MPs is an array of dict. key=member, data= diffOfUsers
        continue; // handle later
      }
      // handle  M, IE, S, Ind
      const [joinedItemsMap, leftItemsMap] = makeDiffPartcipantsMaps(diffData, isOnlyGroupParticipations);
      const diffNum = joinedItemsMap.size - leftItemsMap.size;
      prevStats[statType] -= diffNum; // minus
    }

    // handle MPs
    let diffMP = 0;
    const mpsDiffData = groupData.diff['MPs'];
    for (const diffData of mpsDiffData) {
      const [joinedItemsMap, leftItemsMap] = makeDiffPartcipantsMaps(diffData, isOnlyGroupParticipations);
      const diffNum = joinedItemsMap.size - leftItemsMap.size;
      diffMP += diffNum;
    }
    prevStats['MP'] -= diffMP;  // minus,  MP is the total number of member participants.

    prevStats['P'] = (prevStats['MP'] ?? 0) + (prevStats['IE'] ?? 0) + (prevStats['S'] ?? 0) + (prevStats['Ind'] ?? 0);
  }
  return prevStats;
}

// This is for debug
function makeParticipantsMapsFromGroupsArray(groupsArray, isOnlyGroupParticipations) {
  const mMap = new Map();  // to check duplicated members in onlyGroupParticipationsSummaryGroup  
  const mpMap = new Map();  // to check duplicated users in onlyGroupParticipationsSummaryGroup 
  const ieMap = new Map();
  const sMap = new Map();
  const indMap = new Map();
  const nonIndMap = new Map(); // to check duplicated users in onlyGroupParticipationsSummaryGroup, but not in Individuals
  const ngpmMap = new Map(); // for debug

  const isGroupsArray = groupsArray.length > 1;

  for (const groupInfo of groupsArray) {
    const groupStats = makeGroupStats(undefined); // make groupStats with 0 for all properties
    for (const [member, value] of groupInfo.membersMap) {
      groupStats['M'] += 1;

      // group participants
      const memberInfo = groupInfo.membersMap.get(member);

      if (!isOnlyGroupParticipations || Object(value).hasOwnProperty('groupsSet')) {  // isOnlyGroupPrticipations=true, only groups Participations member is joined
        if (!mMap.has(member)) {
          mMap.set(member, memberInfo);
        }
      } else {
        ngpmMap.set(member, memberInfo); // for debug
      }

      // participants
      for (const user of memberInfo.participants) {
        groupStats['MP'] += 1;

        // group participants
        if (!Object(user).hasOwnProperty('numGroups')) {
          if (isGroupsArray) {
            console.error(`Error: groupsArray, i.e. not Summary, but numGroups exists, ${user.name} ${user.partType} ${user.numGroups}`)
          }
          if (isOnlyGroupParticipations) {
            continue;  // skip users has no numGroups, who do not participate in any group, for onlyGroupParticipationsSummaryGroup
          }
        }

        if (!mpMap.has(user.userHref)) {
          mpMap.set(user.userHref, user);
        }
      }
    }
    for (const user of groupInfo.invitedExperts) {
      groupStats['IE'] += 1;

      // group participants
      if (!Object(user).hasOwnProperty('numGroups')) {
        if (isGroupsArray) {
          console.error(`Error: groupsArray, i.e. not Summary, but no numGroups, ${user.name} ${user.partType} ${user.numGroups}`)
        }
        if (isOnlyGroupParticipations) {
          continue;  // skip users with numGroups == 0, who do not participate in any group, for onlyGroupParticipationsSummaryGroup
        }
      }

      if (!ieMap.has(user.userHref)) {
        ieMap.set(user.userHref, user);
      }
    }

    for (const user of groupInfo.staffs) {
      groupStats['S'] += 1;

      // group participants
      if (!Object(user).hasOwnProperty('numGroups')) {
        if (isGroupsArray) {
          console.error(`Error: groupsArray, i.e. not Summary, but no numGroups, ${user.name} ${user.partType} ${user.numGroups}`)
        }
        if (isOnlyGroupParticipations) {
          continue;  // skip users with numGroups == 0, who do not participate in any group, for onlyGroupParticipationsSummaryGroup
        }
      }

      if (!sMap.has(user.userHref)) {
        sMap.set(user.userHref, user);
      }
    }

    for (const user of groupInfo.individuals) {
      groupStats['Ind'] += 1;

      if (user.partType != 'Ind') {
        console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} has partType ${user.partType} in Individuals of group #${groupInfo.shortname}`);
      }
      // group participants
      if (!Object(user).hasOwnProperty('numGroups')) {
        if (!nonIndMap.has(user.userHref)) {
          nonIndMap.set(user.userHref, user);
        }
        if (isGroupsArray) {
          console.error(`Error: groupsArray, i.e. not Summary, but no numGroups, ${user.name} ${user.partType} ${user.numGroups}`)
        }
        if (isOnlyGroupParticipations) {
          continue;  // skip users with numGroups == 0, who do not participate in any group, for onlyGroupParticipationsSummaryGroup
        }
      }
      if (!indMap.has(user.userHref)) {
        indMap.set(user.userHref, user);
      }
    }
    groupStats['P'] = groupStats['MP'] + groupStats['IE'] + groupStats['S'] + groupStats['Ind'];

    const stats = makeGroupStats(groupInfo);
    if (!checkStats(groupStats, stats)) {
      console.error(`groupStats mismatch for group #${groupInfo.shortname}`);
      console.error(`groupStats=${JSON.stringify(groupStats)}`);
      console.error(`makeGroupStats(groupInfo)=${JSON.stringify(makeGroupStats(groupInfo))}`);

      return undefined
    }
  }
  return {
    mMap,
    mpMap,
    ieMap,
    sMap,
    indMap
  }
}

function dumpDiffOfOnlyGroupParticipationsSummaryStats(prevStats, eventStats) {
  const prevGroupsArray = [prevStats.summaryGroup];
  const prevMaps = makeParticipantsMapsFromGroupsArray(prevGroupsArray, true);
  if (!prevMaps) {
    console.error("Error: dumpDiffOfOnlyGroupParticipationsSummaryStats() makeOnlyGroupParticipationsMaps(prevStats) failed");
    return false;
  }

  const groupsArray = [eventStats.summaryGroup];
  const maps = makeParticipantsMapsFromGroupsArray(groupsArray, true);
  if (!maps) {
    console.error("Error: dumpDiffOfOnlyGroupParticipationsSummaryStats() makeOnlyGroupParticipationsMaps() failed");
    return false;
  }

  dumpMaps(prevMaps, maps);
}

function diffMaps(aMap, bMap) {
  const joinedMap = new Map();
  const leftMap = new Map();

  for (const [key, value] of bMap.entries()) {
    if (!aMap.has(key)) {
      joinedMap.set(key, value);
    }
  }

  for (const [key, value] of aMap.entries()) {
    if (!bMap.has(key)) {
      leftMap.set(key, value);
    }
  }

  return { joined: joinedMap, left: leftMap };
}

function dumpMaps(aMaps, bMaps) {
  const mDiff = diffMaps(aMaps.mMap, bMaps.mMap);
  const mpDiff = diffMaps(aMaps.mpMap, bMaps.mpMap);
  const ieDiff = diffMaps(aMaps.ieMap, bMaps.ieMap);
  const sDiff = diffMaps(aMaps.sMap, bMaps.sMap);
  const indDiff = diffMaps(aMaps.indMap, bMaps.indMap);

  console.error(`mDiff joined:${mDiff.joined.size} left:${mDiff.left.size}`);
  console.error(`mpDiff joined:${mpDiff.joined.size} left:${mpDiff.left.size}`)
  console.error(`ieDiff joined:${ieDiff.joined.size} left:${ieDiff.left.size}`)
  console.error(`sDiff joined:${sDiff.joined.size} left:${sDiff.left.size}`)
  console.error(`indDiff joined:${indDiff.joined.size} left:${indDiff.left.size}`)
}

// check if summaryOfgroupParticipations is consistent with groupsArray.
function checkOnlyGroupParticipations(eventStats) {
  // make onlyGroupParticipationsSummaryStats
  const groupsArray = [eventStats.summaryGroup];
  const onlyGroupParticipationsMaps = makeParticipantsMapsFromGroupsArray(groupsArray, true);
  if (!onlyGroupParticipationsMaps) {
    console.error("Error: checkOnlyGroupParticipations() makeOnlyGroupParsticipationMaps() failed");
    return false;
  }
  const { mMap, mpMap, ieMap, sMap, indMap } = onlyGroupParticipationsMaps;
  const onlyGroupParticipationsSummaryStats = makeGroupStats(undefined);  // make onlyGroupParticipationsSummaryStats with 0 for all properties
  onlyGroupParticipationsSummaryStats['M'] = mMap.size;  // the number of unique members in all groups, which is the same as the number of unique members in onlyGroupParticipationsSummaryGroup.membersMap
  onlyGroupParticipationsSummaryStats['MP'] = mpMap.size;
  onlyGroupParticipationsSummaryStats['IE'] = ieMap.size;
  onlyGroupParticipationsSummaryStats['S'] = sMap.size;
  onlyGroupParticipationsSummaryStats['Ind'] = indMap.size;
  onlyGroupParticipationsSummaryStats['P'] = onlyGroupParticipationsSummaryStats['MP'] + onlyGroupParticipationsSummaryStats['IE'] + onlyGroupParticipationsSummaryStats['S'] + onlyGroupParticipationsSummaryStats['Ind'];

  // make onlyGroupParticipationSummaryMpMap 
  const onlyGroupParticipationSummaryMpMap = new Map();
  eventStats.onlyGroupParticipationsSummaryGroup.memberParticipants.forEach((user) => {
    if (!onlyGroupParticipationSummaryMpMap.has(user.userHref)) {
      onlyGroupParticipationSummaryMpMap.set(user.userHref, user);
    }
  });

  // check if onlyGroupParticipationSummaryMpMap has all member participants in mpMap
  for (const [key, value] of mpMap.entries()) {
    if (!onlyGroupParticipationSummaryMpMap.has(key)) {
      const user = mpMap.get(key);
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} is in onlyGroupParticipationsSummaryGroup.mpMap but not in onlyGroupParticipationsSummaryGroup.mpMap`);
    }
  }

  // check if onlyGroupParticipationSummaryMpMap does not have any member participants in mpMap
  for (const [key, value] of onlyGroupParticipationSummaryMpMap.entries()) {
    if (!mpMap.has(key)) {
      const user = onlyGroupParticipationSummaryMpMap.get(key);
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${JSON.stringify(user)} is in onlyGroupParticipationsSummaryGroup.mpMap but not in onlyGroupParticipationsSummaryGroup.mpMap`);

      for (const groupInfo of eventStats.groupsArray) {
        for (const user of groupInfo.allParticipants) {
          if (user.userHref == key) {
            console.error(`  Debug: user ${user.name} ${user.userHref} is a participant in group #${groupInfo.shortname}`);
          }
        }
      }
    }
  }

  // check if no indivisuals exist in onlyGroupParticipationSummaryIndMap
  const onlyGroupParticipationSummaryIndMap = new Map();
  eventStats.onlyGroupParticipationsSummaryGroup.individuals.forEach((user) => {
    if (!onlyGroupParticipationSummaryIndMap.has(user.userHref)) {
      onlyGroupParticipationSummaryIndMap.set(user.userHref, user);
    }
  });
  let count = 0;
  for (const [key, value] of onlyGroupParticipationSummaryIndMap.entries()) {
    const user = onlyGroupParticipationSummaryIndMap.get(key);
    if (!Object(user).hasOwnProperty('numGroups')) {
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} has no numGroups in onlyGroupParticipationsSummaryGroup.indMap, but should be skipped since they do not participate in any group.`);
    }
    if (!indMap.has(key)) {
      count++;
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${JSON.stringify(user)} is in onlyGroupParticipationsSummaryGroup.individuals but not in onlyGroupParticipationsSummaryGroup.indMap`);

      for (const groupInfo of eventStats.groupsArray) {
        for (const user of groupInfo.allParticipants) {
          if (user.userHref == key) {
            console.error(`  Debug: user ${user.name} ${user.userHref} is a participant in group #${groupInfo.shortname}`);
          }
        }
      }
    }
  }
  if (count != 0) {
    console.error('Error: GroupParticipation of individuals are not found in allParticipantsof Indivisual missing count=', count);
    return false;
  }

  // check if all indivisuals in onlyGroupParticipationsSummaryGroup.ieMap exist in summaryGroup.invitedExperts
  const summaryGroupIEMap = new Map(eventStats.summaryGroup.invitedExperts.map(v => [v.userHref, v]));
  for (const [userHref, user] of ieMap) {
    if (!summaryGroupIEMap.has(userHref)) {
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} is in onlyGroupParticipationsSummaryGroup.ieMap, but not in eventStats.summaryGroup.invitedExperts`);
    }
  }

  // check if all indivisuals in onlyGroupParticipationsSummaryGroup.ieMap exist in summaryGroup.invitedExperts
  const summaryGroupSMap = new Map(eventStats.summaryGroup.staffs.map(v => [v.userHref, v]));
  for (const [userHref, user] of sMap) {
    if (!summaryGroupSMap.has(userHref)) {
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} is in onlyGroupParticipationsSummaryGroup.sMapm but not in eventStats.summaryGroup.staffs`);
    }
  }

  // check if all indivisuals in onlyGroupParticipationsSummaryGroup.indMap exist in summaryGroup.indivisuals
  const summaryGroupIndMap = new Map(eventStats.summaryGroup.individuals.map(v => [v.userHref, v]));
  for (const [userHref, user] of indMap) {
    if (!summaryGroupIndMap.has(userHref)) {
      console.error(`Error: checkOnlyGroupParticipations() user ${user.name} ${user.userHref} is in onlyGroupParticipationsSummaryGroup.indMap in eventStats.summaryGroup.individuals.`);
    }
  }

  // check if onlyGroupParticipationsSummaryStats is consistent with stats made from eventStats.onlyGroupParticipationsSummaryGroup)
  const stats = makeGroupStats(eventStats.onlyGroupParticipationsSummaryGroup);
  if (!checkStats(onlyGroupParticipationsSummaryStats, stats)) {
    console.error("onlyGroupParticipationsSummaryStats mismatch");

    const maps = makeParticipantsMapsFromGroupsArray(eventStats.groupsArray, true);

    dumpMaps(maps, onlyGroupParticipationsMaps);

    return false;
  }
  return true;
}

// This is for debug
function checkDiffSummaryStats(prevSummaryStats, diff, summaryStats, isOnlyGroupParticipations) {
  console.log(`checkDiffOfOnlyGroupParticipationsSummaryStats() prevSummaryStats=${JSON.stringify(prevSummaryStats)} onlyGroupParticipationsSummaryStats=${JSON.stringify(summaryStats)} isOnlyGroupParticipations=${isOnlyGroupParticipations}`);
  try {
    const stats = { ...prevSummaryStats };  // copy summary stats to caliculate onlyGroupParticipationsSummaryStats

    // members
    const [joinedMembersMap, leftMembersMap] = makeDiffPartcipantsMaps(diff['M'], isOnlyGroupParticipations);
    const diffCountM = joinedMembersMap.size - leftMembersMap.size;


    // member participations
    const joinedMPMap = new Map();
    const leftMPMap = new Map();
    const diffMPs = diff['MPs'] ?? [];  // diff of MP is an array
    let diffMPJoinedCount = 0;
    let diffMPLeftCount = 0;
    for (const diffData of diffMPs) {
      const [joinedMap, leftMap] = makeDiffPartcipantsMaps(diffData, isOnlyGroupParticipations);
      diffMPJoinedCount += joinedMap.size;
      diffMPLeftCount += leftMap.size;
      for (const [k, v] of joinedMap) {
        joinedMPMap.set(k, v);
      }
      for (const [k, v] of leftMap) {
        leftMPMap.set(k, v);
      }
    }
    if (diffMPJoinedCount != joinedMPMap.size || diffMPLeftCount != leftMPMap.size) {
      console.error("Error: checkDiffSummaryStats member participation dupplication", diffMPJoinedCount, diffMPLeftCount, joinedMPMap.size, leftMPMap.size);
      return false;
    }
    const diffCountMPs = joinedMPMap.size - leftMPMap.size;

    // IE, S, Ind
    const [joinedIEMap, leftIEMap] = makeDiffPartcipantsMaps(diff['IE'], isOnlyGroupParticipations);
    const [joinedSMap, leftSMap] = makeDiffPartcipantsMaps(diff['S'], isOnlyGroupParticipations);
    const [joinedIndMap, leftIndMap] = makeDiffPartcipantsMaps(diff['Ind'], isOnlyGroupParticipations);
    // do not make diff of P because it can be generated by the diff of MP, IE, S, and Ind.
    const diffCountIE = joinedIEMap.size - leftIEMap.size;
    const diffCountS = joinedSMap.size - leftSMap.size;
    const diffCountInd = joinedIndMap.size - leftIndMap.size;

    // update stats
    stats['M'] += diffCountM;
    stats['MP'] += diffCountMPs;
    stats['IE'] += diffCountIE;
    stats['S'] += diffCountS;
    stats['Ind'] += diffCountInd;
    stats['P'] = stats['MP'] + stats['IE'] + stats['S'] + stats['Ind'];

    const ret = checkStats(stats, summaryStats); // check stats is correct
    return ret;
  } catch (e) {
    console.log(e);
    return false;
  }
}


function checkStats(statsA, statsB) {
  const keys = ['M', 'MP', 'IE', 'S', 'Ind', 'P']; // Do not check Specifications because its diff is supported yet.
  let totalDiff = 0;
  for (const key of keys) {
    const valA = parseInt(statsA[key] || 0);
    const valB = parseInt(statsB[key] || 0);
    const diff = valA - valB;
    if (diff) {
      console.error(`Error: stats mismatch: ${key}: ${valA} -> ${valB} ${diff > 0 ? "+" : ""}${diff}`);
    }
    totalDiff += diff;
  }
  return totalDiff == 0 ? true : false;
}

function makePrevEventData(eventData) {
  try {
    const summaryStats = makePrevGroupStats(eventData.summary);
    const groups = {};
    for (const [shortname, groupData] of Object.entries(eventData.groups)) {
      const groupStats = makePrevGroupStats(groupData);
      groups[shortname] = {
        stats: groupStats
      };
    }
    const prevEventData = {
      summary: {
        stats: summaryStats
      },
      groups
    }
    return prevEventData;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

export function checkTimelineData(collectedTimelineData) {
  let timestamps = Object.keys(collectedTimelineData);
  timestamps = timestamps.filter(key => key != '_metadata');

  for (let i = timestamps.length - 1; i > 0; i--) {   // decending
    const key = timestamps[i];
    const dataEntry = collectedTimelineData[key];
    const eventTimestamp = parseInt(key);
    const prevTimestamp = parseInt(dataEntry.prevTimestamp);

    if (i > 0) {
      console.log(`checkTimeLine() eventTimestamp ${eventTimestamp} prevTimestamp=${prevTimestamp}`)

      if (eventTimestamp < prevTimestamp) {
        console.error(`Error: timestamp=${eventTimestamp} in EventDataEntry is older than previous Timestamp=${prevTimestamp}`)
        return false;
      }
      const prevKey = timestamps[i - 1];
      if (parseInt(prevKey) != prevTimestamp) {
        console.error(`Error: event data is out of order, key=${key} prevKey=${prevKey} prevTimestamp=${prevTimestamp}`)
        return false;
      }

      // 現在のeventDataからからprevEventDataを作成。
      const madePrevEventData = makePrevEventData(dataEntry.eventData)
      if (madePrevEventData == undefined) {
        return false;
      }
      // 本物のprevEventDataを読む
      const prevDataEntry = collectedTimelineData[prevTimestamp];
      const prevEventData = prevDataEntry.eventData;
      // 作成したprevEventDataと本物のprevEventDataを比較する。

      let errorCount = 0;
      if (!checkStats(prevEventData.summary.stats, madePrevEventData.summary.stats)) {
        console.error(`checkTimelineData() Mismatch Stats with summary`)
        errorCount++;
      }
      for (const [key, data] of Object.entries(prevEventData.groups)) {
        if (data.stats == undefined || madePrevEventData.groups[key]?.stats == undefined) {
          // Note that makePreventData does not contains the closed group
          console.log("closed group", key);
          if (data.stats != undefined || madePrevEventData.groups[key]?.stats != undefined) {
            console.error(`checkTimelineData() Stats exists in the closed group ${key}`)
            errorCount++;
          }
        } else {
          if (!checkStats(data.stats, madePrevEventData.groups[key].stats)) {
            console.error(`checkTimelineData() Mismatch group ${key}`)
            errorCount++;
          }
        }
      }
      if (errorCount > 0) {
        console.log(`checkTimelineData() TotalError: ${errorCount}`)
        return false;
      }
    }
  }
  return true;
}

