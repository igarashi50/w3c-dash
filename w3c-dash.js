// w3c-dash.js

import { makeStats, getDataEntry } from './w3c-stats.js';
import { loadApiDataAsync, fetchDataEntryAsync } from './w3c-api.js';

let w3cStats = null; // 初回のみロード
let loadingDotsTimer = null;
let loadingDotsCount = 0;

const labels = {
  wg: 'Working Groups',
  ig: 'Interest Groups',
  cg: 'Community Groups',
  tf: 'Task Forces',
  other: 'Other Groups',
  all: 'All Groups'
};

const params = new URLSearchParams(window.location.search);
const dataParam = params.get('data')
const url = dataParam || 'data/w3c-data.json'; // relative 
// Relative / Absolute 両対応で正規化
const apiDataUrl = new URL(url, location.href);
// const piDataUrl = 'data-new/w3c-data.json';

async function renderDashboard() {
  const loadingStatus = document.getElementById('status');
  const summarySection = document.getElementById('summary');
  const groupsSection = document.getElementById('groups');

  // ローディング開始時はsummarySection, groupsSectionを非表示
  if (summarySection) summarySection.style.display = 'none';
  if (groupsSection) groupsSection.style.display = 'none';

  if (loadingStatus) {
    loadingStatus.className = 'loading';
    loadingStatus.textContent = 'Loading W3C API data';
    loadingStatus.style.display = '';

    // ドットアニメーション開始
    if (loadingDotsTimer) clearInterval(loadingDotsTimer);
    loadingDotsCount = 0;
    loadingDotsTimer = setInterval(() => {
      loadingDotsCount = (loadingDotsCount + 1) % 4; // 0,1,2,3
      let dots = '.'.repeat(loadingDotsCount);
      loadingStatus.textContent = 'Loading W3C API data' + dots;
    }, 400);
  }

  try {
    // 初回のみロード
    if (w3cStats === null) {
      const apiData = await loadApiDataAsync(apiDataUrl);
      w3cStats = makeStats(apiData); // ES Moduleのw3c-stats.jsのの関数
      if (!w3cStats) {
        alert("w3c stats is not avaiable")
      }
    }
    const groupsArray = w3cStats.groupsArray;

    // Summary表示をサブ関数に分離
    _mainRenderSummary(groupsArray.length, w3cStats.summaryGroup, w3cStats.onlyGroupParticipationsSummaryGroup, w3cStats.lastChecked);

    _mainRenderGroups(groupsArray);

    // ローディング完了後に表示
    if (summarySection) summarySection.style.display = '';
    if (groupsSection) groupsSection.style.display = '';
    if (loadingStatus) loadingStatus.style.display = 'none';

  } catch (e) {
    // エラー時も他は非表示のまま
    if (loadingStatus) {
      loadingStatus.className = 'error';
      loadingStatus.textContent = `Error loading data: ${e.message || String(e)}`;
      loadingStatus.style.display = '';
    }
    if (summarySection) summarySection.style.display = 'none';
    if (groupsSection) groupsSection.style.display = 'none';
    console.error(e);
  }

  if (loadingDotsTimer) {
    clearInterval(loadingDotsTimer);
    loadingDotsTimer = null;
  }
}

document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
  document.body.classList.remove('modal-open');  // enable body scroll
  if (w3cStats) {
    _mainRenderSummaryStats(w3cStats.groupsArray.length, w3cStats.summaryGroup, w3cStats.onlyGroupParticipationsSummaryGroup);
  }
});

document.getElementById('popupOverlay').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
  document.body.classList.remove('modal-open');  // enable body scroll
  if (w3cStats) {
    _mainRenderSummaryStats(w3cStats.groupsArray.length, w3cStats.summaryGroup, w3cStats.onlyGroupParticipationsSummaryGroup);
  }
});

// ESCキー対応も同様
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popup = document.getElementById('popup');
    const popupOverlay = document.getElementById('popupOverlay');
    if (popup.style.display === 'flex') {
      popup.style.display = 'none';
      popupOverlay.style.display = 'none';
      document.body.classList.remove('modal-open'); // ← 追加
    }
  }
});

renderDashboard() // ループ
// 以下は関数群

function getOnlyGroupParticipationsToggle() {
  return localStorage.onlyGroupParticipations === 'true';   //
}

function flipOnlyGroupParticipationsToggle(toggleBtn) {
  const isChecked = !getOnlyGroupParticipationsToggle();
  localStorage.onlyGroupParticipations = isChecked ? 'true' : 'false';  // 文字列で保存

  return updateOnlyGroupParticipationsToggle(toggleBtn);
}
function updateOnlyGroupParticipationsToggle(toggleBtn) {
  const checkSpan = toggleBtn.querySelector('.check-mark');
  const isChecked = getOnlyGroupParticipationsToggle();
  toggleBtn.classList.toggle('checked', isChecked);
  return isChecked;
}
/*
以下はmainパネルの表示用のサブ関数 '_main'で始まる関数
*/
function _mainRenderSummary(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup, lastChecked) {
  // Summary情報を表示
  // 日付表示
  let dateStr = '';
  if (lastChecked) {
    const date = new Date(lastChecked);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getUTCMonth()];
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    dateStr = `as of ${month} ${day}, ${year}`;
  }
  const dateStrSpan = document.getElementById('dateStr');
  if (dateStrSpan) {
    dateStrSpan.textContent = dateStr;
  }

  // トグルボタンのイベントハンドラ追加
  const toggleBtn = document.getElementById('toggleOnlyGroupParticipations');
  if (toggleBtn) {
    updateOnlyGroupParticipationsToggle(toggleBtn);
    toggleBtn.onclick = () => {
      flipOnlyGroupParticipationsToggle(toggleBtn);
      // currentFilterを必ず維持して渡す
      _mainRenderSummaryStats(
        w3cStats.groupsArray.length,
        w3cStats.summaryGroup,
        w3cStats.onlyGroupParticipationsSummaryGroup
      );
    };
  }
  // Summaryクリックイベント
  const summarySection = document.getElementById('summary');
  function handleSummaryClick(ev) {
    const target = ev.target.closest('.clickable');
    if (!target) return;
    const summaryType = target.getAttribute('data-summary-type');
    if (summaryType) {
      let initialFilter = summaryType;

      const tableSwitcher = document.getElementById('tableSwitcher');
      const isShowBoth = tableSwitcher == undefined || tableSwitcher.style.display == 'none';
      popupSheet(summaryGroup, initialFilter, onlyGroupParticipationsSummaryGroup, isShowBoth);
    }
  }
  if (summarySection) {
    summarySection.addEventListener('click', handleSummaryClick);
    summarySection.addEventListener('touchend', handleSummaryClick);
  }
  // 初期時点でのsummary値描画
  _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup);
}

function _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup = null) {
  const toggleOnlyGroupParticipations = getOnlyGroupParticipationsToggle();
  const toggleBtn = document.getElementById('toggleOnlyGroupParticipations');
  updateOnlyGroupParticipationsToggle(toggleBtn);

  const useGroupInfo = (toggleOnlyGroupParticipations && onlyGroupParticipationsSummaryGroup)
    ? onlyGroupParticipationsSummaryGroup
    : summaryGroup


  // participations summary値の更新
  const summfaryGroups = document.getElementById('summaryGroups');
  if (summfaryGroups) summfaryGroups.textContent = groupCounts;
  const summaryMembers = document.getElementById('summaryMembers');
  if (summaryMembers) summaryMembers.textContent = useGroupInfo.membersMap.size;
  const summaryMemberParticipants = document.getElementById('summaryMemberParticipants');
  if (summaryMemberParticipants) summaryMemberParticipants.textContent = useGroupInfo.memberParticipants.length;
  const summaryInvitedExperts = document.getElementById('summaryInvitedExperts');
  if (summaryInvitedExperts) summaryInvitedExperts.textContent = useGroupInfo.invitedExperts.length;
  const summaryStaffs = document.getElementById('summaryStaffs');
  if (summaryStaffs) summaryStaffs.textContent = useGroupInfo.staffs.length;
  const summaryIndividuals = document.getElementById('summaryIndividuals');
  if (summaryIndividuals) summaryIndividuals.textContent = useGroupInfo.individuals.length;
  const summaryAllParticipants = document.getElementById('summaryAllParticipants');
  if (summaryAllParticipants) summaryAllParticipants.textContent = useGroupInfo.allParticipants.length;

  // specifications  summary値の更新
  const summarySpecifications = document.getElementById('summarySpecifications');
  if (summarySpecifications) summarySpecifications.textContent = useGroupInfo.specsMap.size;
  const summaryRecommendations = document.getElementById('summaryRecommendations');
  if (summaryRecommendations) summaryRecommendations.textContent = useGroupInfo.recommendations.length;
  const summaryCandidateRecommendations = document.getElementById('summaryCandidateRecommendations');
  if (summaryCandidateRecommendations) summaryCandidateRecommendations.textContent = useGroupInfo.candidateRecommendations.length;
  const summaryDraftStandards = document.getElementById('summaryDraftStandards');

  if (summaryDraftStandards) summaryDraftStandards.textContent = useGroupInfo.draftStandards.length;
  const summaryRetiredSpecs = document.getElementById('summaryRetiredSpecs');
  if (summaryRetiredSpecs) summaryRetiredSpecs.textContent = useGroupInfo.retiredSpecs.length;
  const summaryOtherSpecs = document.getElementById('summaryOtherSpecs');
  if (summaryOtherSpecs) summaryOtherSpecs.textContent = useGroupInfo.otherSpecs.length;
  const summaryAllVersions = document.getElementById('summaryAllVersions');
  if (summaryAllVersions) summaryAllVersions.textContent = useGroupInfo.allVersions.length;
}

function _mainFilterAndSortGroups(groupsArray, filterType, sortBy) {
  console.log(`[FilterAndSort] filterType=${filterType}, sortBy=${sortBy}`);
  const startTime = performance.now();

  const filteredResults = filterType === 'all'
    ? groupsArray
    : groupsArray.filter(g => g.groupType === filterType);

  let sortedResults;
  switch (sortBy) {
    case 'members':
      sortedResults = [...filteredResults].sort((a, b) => (b.membersMap.size || 0) - (a.membersMap.size || 0));
      break;
    case 'memberParticipants':
      sortedResults = [...filteredResults].sort((a, b) => (b.memberParticipants.length || 0) - (a.memberParticipants.length || 0));
      break;
    case 'invitedExperts':
      sortedResults = [...filteredResults].sort((a, b) => (b.invitedExperts.length || 0) - (a.invitedExperts.length || 0));
      break;
    case 'staffs':
      sortedResults = [...filteredResults].sort((a, b) => (b.staffs.length || 0) - (a.staffs.length || 0));
      break;
    case 'individuals':
      sortedResults = [...filteredResults].sort((a, b) => (b.individuals.length || 0) - (a.individuals.length || 0));
      break;

    case 'allParticipants':
      sortedResults = [...filteredResults].sort((a, b) => (b.allParticipants.length || 0) - (a.allParticipants.length || 0));
      break;

    case 'specifications':
      sortedResults = [...filteredResults].sort((a, b) => (b.specsMap.size || 0) - (a.specsMap.size || 0));
      break;
    case 'recommendations':
      sortedResults = [...filteredResults].sort((a, b) => (b.recommendations.length || 0) - (a.recommendations.length || 0));
      break;
    case 'candidateRecommendations':
      sortedResults = [...filteredResults].sort((a, b) => (b.candidateRecommendations.length || 0) - (a.candidateRecommendations.length || 0));
      break;
    case 'draftStandards':
      sortedResults = [...filteredResults].sort((a, b) => (b.draftStandards.length || 0) - (a.draftStandards.length || 0));
      break;
    case 'retiredSpecs':
      sortedResults = [...filteredResults].sort((a, b) => (b.retiredSpecs.length || 0) - (a.retiredSpecs.length || 0));
      break;
    case 'otherSpecs':
      sortedResults = [...filteredResults].sort((a, b) => (b.otherSpecs.length || 0) - (a.otherSpecs.length || 0));
      break;

    case 'allVersions':
      sortedResults = [...filteredResults].sort((a, b) => (b.allVersions.length || 0) - (a.allVersions.length || 0));
      break;

    case 'name':
    default:
      sortedResults = [...filteredResults].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;
  }
  const endTime = performance.now();
  console.log(`[FilterAndSort] Completed in ${(endTime - startTime).toFixed(2)} ms`);
  return sortedResults
}


function _mainRenderGroups(groupsArray) {
  _mainInitTableSwitcher();

  _mainRenderGroupsFilter(groupsArray);
  _mainRenderGroupsList(groupsArray);
}

function _mainInitTableSwitcher() {
  const tableSwitcher = document.getElementById('tableSwitcher');
  if (tableSwitcher == null || tableSwitcher.style.display == 'none') {
    return;
  }
  const groupsList = document.getElementById('groupsList');

  // 初期状態復元
  const show = localStorage.getItem('groupsColumnMode') || 'participations';
  // active UI
  tableSwitcher.querySelectorAll('.segment')
    .forEach(b => {
      if (b.dataset.show === show) {
        b.classList.add('active')
      } else {
        b.classList.remove('active')
      }
    });
  // aria
  tableSwitcher.querySelectorAll('.segment')
    .forEach(b => {
      if (b.dataset.show === show) {
        b.setAttribute('aria-selected', 'true');
      } else {
        b.setAttribute('aria-selected', 'false');
      }
    });

  // クラス切り替えで、participations/specificationsの表示制御
  groupsList.classList.remove('only-participations', 'only-specifications');
  groupsList.classList.add(`only-${show}`);

  tableSwitcher.querySelectorAll('.segment')
    .forEach(btn => {
      btn.onclick = () => {
        const show = btn.dataset.show;
        const currentColumnMode = localStorage.getItem('groupsColumnMode');
        if (currentColumnMode != show) {
          // active UI
          tableSwitcher.querySelectorAll('.segment')
            .forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // aria
          tableSwitcher.querySelectorAll('.segment')
            .forEach(b => b.setAttribute('aria-selected', 'false'));
          btn.setAttribute('aria-selected', 'true');

          groupsList.classList.remove('only-participations', 'only-specifications');
          groupsList.classList.add(`only-${show}`);

          localStorage.setItem('groupsColumnMode', show);
        }
      }
    });
}

function _mainRenderGroupsFilter(groupsArray) {
  // 選択したフィルターのグループ名ヘッダーのラベル更新
  const filterType = localStorage.getItem('groupTypeFilter') || 'wg';

  // 各タイプのグループ数を計算して、GroupSectionのフィルターのラベルの値を更新
  const counts = {
    wg: 0,
    ig: 0,
    cg: 0,
    tf: 0,
    other: 0,
    all: groupsArray.length
  };

  groupsArray.forEach(g => {
    const type = g.groupType;
    if (counts.hasOwnProperty(type)) {
      counts[type]++;
    } else {
      console.log(`Unknown group type: ${type} for group ${g.name}`);
    }
  });

  const groupTypeFilter = document.getElementById('groupTypeFilter');
  groupTypeFilter.querySelectorAll('.filter-btn').forEach(btn => {
    const type = btn.dataset.type;
    const countSpan = btn.querySelector('.count');

    // 数値のみ更新
    if (countSpan && counts[type] !== undefined) {
      countSpan.textContent = counts[type];
    }

    // 初期アクティブ状態
    btn.classList.toggle('active', type === filterType);

    // クリックイベント
    btn.onclick = (e) => {
      e.stopPropagation();

      // active 切り替え
      groupTypeFilter
        .querySelectorAll('.filter-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 状態保存
      localStorage.setItem('groupTypeFilter', type);

      _mainDrawTableBodyContainer(groupsArray);
    };
  });
}

function _mainRenderGroupsList(groupsArray) {
  const sortBy = localStorage.getItem('groupsListSortBy') || 'name';

  const headerRow = document.getElementById('groupsHeaderRow');

  headerRow.querySelectorAll('th.sortable').forEach(th => {
    const key = th.dataset.key;

    // 初期状態
    th.classList.toggle('sorted', key === sortBy);

    th.onclick = () => {
      // reset
      headerRow.querySelectorAll('th.sortable')
        .forEach(t => t.classList.remove('sorted'));

      // activate
      th.classList.add('sorted');

      localStorage.setItem('groupsListSortBy', key);

      // 再描画
      _mainDrawTableBodyContainer(groupsArray);
    };
  });

  // 初回描画
  _mainDrawTableBodyContainer(groupsArray);
}

function _mainDrawTableBodyContainer(groupsArray) {
  const filterType = localStorage.getItem('groupTypeFilter') || 'wg';
  // ソート基準をlocalStorageから取得し、なければselectの値を使う
  const sortBy = localStorage.getItem('groupsListSortBy');

  const groupListContainer = document.getElementById('groupsListContainer');
  // テーブルボディ生成して描画
  const frag = _mainCreateTableBody(groupsArray, filterType, sortBy);
  groupListContainer.replaceChildren(frag);

}

function _mainCreateTableBody(groupsArray, filterType, sortBy) {
  const sortedResults = _mainFilterAndSortGroups(groupsArray, filterType, sortBy);

  const nameHeaderLabel = document.querySelector('.col-name .label');
  if (nameHeaderLabel) {
    nameHeaderLabel.textContent =
      `${labels[filterType]}: ${sortedResults.length}`;
  }


  // チャートを描画
  const maxMembers = Math.max(...sortedResults.map(g => g.membersMap instanceof Map ? g.membersMap.size : 0));
  const maxParticipants = Math.max(...sortedResults.map(g => Array.isArray(g.allParticipants) ? g.allParticipants.length : 0));
  // 両方のチャートで同じスケールを使用
  const maxValueOfParticipations = Math.max(maxMembers, maxParticipants);
  const maxRecomendations = Math.max(...sortedResults.map(g => g.recomendations ? g.recomendations.length : 0));
  const maxSpecifications = Math.max(...sortedResults.map(g => g.specsMap ? g.specsMap.size : 0));
  // 両方のチャートで同じスケールを使用
  const maxValueOfSpecifications = Math.max(maxRecomendations, maxSpecifications);

  // テーブル本体
  const bodyTable = document.createElement('table');
  bodyTable.className = 'groups-table groups-table-body';

  // tbody生成
  const tbody = document.createElement('tbody');

  // HTML文字列を一括生成
  let html = '';
  for (let i = 0; i < sortedResults.length; i++) {
    const g = sortedResults[i];
    const originalIndex = groupsArray.indexOf(g);
    const memberChartHtml = _mainCreateMemberChartsHtml(g, maxValueOfParticipations);
    const participantChartHtml = _mainCreateparticipantsChartsHtml(g, maxValueOfParticipations, sortBy);
    const specChartHtml = _mainCreateSpecificationsCharts(g, maxSpecifications, sortBy);
    const recomendationsChartHtml = _mainCreateRecomendationChartsHtml(g, maxValueOfSpecifications);
    const isCG = g.groupType == 'cg';   // IEs are not applied for CGs

    html += `<tr>
      <td class="name-cell col-name">${g.homepage
        ? `<a href="${g.homepage}" target="_blank" style="color:#0366d6;text-decoration:none;">${escapeHtml(g.name)}</a>`
        : escapeHtml(g.name)
      }</td>
      <td class="number-cell col-m col-participations"><span class="clickable${g.isException ? ' exception' : ''}" data-index="${originalIndex}" data-type="members">${g.membersMap.size || 0}</span></td>
      <td class="number-cell col-mp col-participations"><span class="clickable${g.isException ? ' exception' : ''}" data-index="${originalIndex}" data-type="memberParticipants">${g.memberParticipants.length || 0}</span></td>
      <td class="number-cell col-ie col-participations"><span class="clickable${(g.isException || isCG) ? ' exception' : ''}" data-index="${originalIndex}" data-type="invitedExperts">${g.invitedExperts.length || 0}</span>${g._error ? '<div class="error">(err)</div>' : ''}</td>
      <td class="number-cell col-s col-participations"><span class="clickable" data-index="${originalIndex}" data-type="staffs">${g.staffs.length || 0}</span></td>
      <td class="number-cell col-ind col-participations"><span class="clickable${g.isException ? ' exception' : ''}" data-index="${originalIndex}" data-type="individuals">${g.individuals.length || 0}</span></td>
      <td class="number-cell col-ap col-participations"><span class="clickable" data-index="${originalIndex}" data-type="allParticipants">${g.allParticipants.length || 0}</span></td>
      <td class="number-cell col-specs col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="specifications">${g.specsMap.size || 0}</span></td>
      <td class="number-cell col-rec col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="recommendations">${g.recommendations.length || 0}</span></td>
      <td class="number-cell col-cr col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="candidateRecommendations">${g.candidateRecommendations.length || 0}</span></td>
      <td class="number-cell col-ds col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="draftStandards">${g.draftStandards.length || 0}</span></td>
      <td class="number-cell col-ret col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="retiredSpecs">${g.retiredSpecs.length || 0}</span></td>
      <td class="number-cell col-oth col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="otherSpecs">${g.otherSpecs.length || 0}</span></td>
      <td class="number-cell col-vers col-specifications"><span class="clickable" data-index="${originalIndex}" data-type="allVersions">${g.allVersions.length || 0}</span></td>
      <td class="charts-cell col-charts col-participations">
        <div id="members-chart-${i}" class="chart-bar">${memberChartHtml}</div>
        <div id="participants-chart-${i}" class="chart-bar">${participantChartHtml}</div>
      </td>
      <td class="charts-cell col-charts col-specifications">
        <div id="specs-chart-${i}" class="chart-bar">${specChartHtml}</div>
        <div id="recs-chart-${i}" class="chart-bar"">${recomendationsChartHtml}</div>
      </td>
    </tr>`;
  }

  // 一括挿入
  tbody.innerHTML = html;
  bodyTable.appendChild(tbody);

  // 必要ならイベントリスナを後付け
  tbody.querySelectorAll('.clickable').forEach(el => {
    el.addEventListener('click', function (e) {
      const index = this.getAttribute('data-index');
      const type = this.getAttribute('data-type');

      const tableSwitcher = document.getElementById('tableSwitcher');
      const isShowBoth = tableSwitcher == undefined || tableSwitcher.style.display == 'none';

      // 例: 詳細ポップアップ
      popupSheet(groupsArray[index], type, undefined, isShowBoth);
      e.stopPropagation();
    });
  });

  // DocumentFragmentで返す場合
  const frag = document.createDocumentFragment();
  frag.appendChild(bodyTable);
  return frag;
}

// HTMLエスケープ関数
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function _mainCreateMemberChartsHtml(g, maxValue) {
  const count = g.membersMap instanceof Map ? g.membersMap.size : 0;
  return _mainCreateBarChartHtml(
    [{ value: count, key: 'members' }],
    maxValue
  );
}

function _mainCreateRecomendationChartsHtml(g, maxValue) {
  const count = g.recommendations ? g.recommendations.length : 0;
  return _mainCreateBarChartHtml(
    [{ value: count, key: 'recommendations' }],
    maxValue
  );
}

function _mainCreateparticipantsChartsHtml(g, maxValue, sortBy) {
  let stack = [
    { key: 'memberParticipants', value: g.memberParticipants?.length ?? 0 },
    { key: 'invitedExperts', value: g.invitedExperts?.length ?? 0 },
    { key: 'staffs', value: g.staffs?.length ?? 0 },
    { key: 'individuals', value: g.individuals?.length ?? 0 }
  ];

  const idx = stack.findIndex(s => s.key === sortBy);
  if (idx > 0) {
    const [item] = stack.splice(idx, 1);
    stack.unshift(item);
  }

  return _mainCreateBarChartHtml(stack, maxValue);
}

function _mainCreateSpecificationsCharts(g, maxValue, sortBy) {
  let stack = [
    { key: 'recommendations', value: g.recommendations?.length ?? 0 },
    { key: 'candidateRecommendations', value: g.candidateRecommendations?.length ?? 0 },
    { key: 'draftStandards', value: g.draftStandards?.length ?? 0 },
    { key: 'retiredSpecs', value: g.retiredSpecs?.length ?? 0 },
    { key: 'otherSpecs', value: g.otherSpecs?.length ?? 0 }
  ];

  const idx = stack.findIndex(s => s.key === sortBy);
  if (idx > 0) {
    const [item] = stack.splice(idx, 1);
    stack.unshift(item);
  }

  return _mainCreateBarChartHtml(stack, maxValue);
}
function _mainCreateBarChartHtml(items, maxValue) {
  if (!items || !maxValue || maxValue === 0) return '';

  const values = items.map(i => i.value);
  const totalValue = values.reduce((s, v) => s + v, 0);
  const isSingle = items.length === 1;

  let barsHtml = '';
  let totalBarWidthPercent = 0;

  if (isSingle) {
    const { value, key } = items[0];
    if (value > 0) {
      barsHtml = `
        <div class="chart-bar-segment chart-color-${key}" style="width:100%;"></div>
      `;
      totalBarWidthPercent = (value / maxValue) * 100;
    }
  } else {
    let sum = 0;

    items.forEach(({ value, key }) => {
      if (value <= 0) return;

      const width = (value / totalValue) * 100;
      const left = (sum / totalValue) * 100;
      const showLabel = (width * totalValue / maxValue) > 5;

      barsHtml += `
        <div class="chart-bar-segment chart-color-${key}"
             style="width:${width}%; left:${left}%;">
          ${showLabel ? value : ''}
        </div>
      `;
      sum += value;
    });

    totalBarWidthPercent = (totalValue / maxValue) * 100;
  }

  const digits = maxValue.toString().length;
  const labelHtml = totalValue > 0
    ? `<div class="chart-total-label" style="width:${digits}ch;">${totalValue}</div>`
    : '';

  const pad = 100 - totalBarWidthPercent;
  const padHtml = pad > 0
    ? `<div class="chart-pad" style="width:${pad}%;"></div>`
    : '';

  return `
    <div class="chart-wrapper">
      <div class="chart-bar" style="width:${totalBarWidthPercent}%;">
        ${barsHtml}
      </div>
      ${labelHtml}
      ${padHtml}
    </div>
  `;
}


/* ##
 popupSheet()でPopupを表示, 利用されるサブ関数の名前は’_poupup’で始まる
 ### */
async function popupSheet(groupInfo, initialFilter, onlyGroupParticipationsSummaryGroup, isShowBoth = true) {
  const popup = document.getElementById('popup');
  const overlay = document.getElementById('popupOverlay');
  const title = document.getElementById('popupTitle');
  title.textContent = groupInfo.name;

  // まず枠だけ即時表示
  popup.style.display = 'flex';
  overlay.style.display = 'block';
  document.body.classList.add('modal-open');  // disable body scroll (i.e. behind popup)

  let initialFilterParticipations = 'members';
  let initialFilterSpecifications = 'specifications';
  switch (initialFilter) {
    case 'members':
    case 'memberParticipants':
    case 'invitedExperts':
    case 'staffs':
    case 'individuals':
    case 'allParticipants':
      initialFilterParticipations = initialFilter;
      initialFilterSpecifications = isShowBoth ? localStorage.getItem('popupSpecificationsFilter') || 'specifications' : null;
      break;
    case 'specifications':
    case 'recommendations':
    case 'candidateRecommendations':
    case 'draftStandards':
    case 'retiredSpecs':
    case 'otherSpecs':
    case 'allVersions':
      initialFilterParticipations = isShowBoth ? localStorage.getItem('popupParticipationsFilter') || 'members' : null;
      initialFilterSpecifications = initialFilter;
      break;
    default:
      // デフォルト値を使用
      break;
  }

  const popupParticipationsBody = document.getElementById('popupParticipationsBody')
  const popupSpecificationsBody = document.getElementById('popupSpecificationsBody')
  popupParticipationsBody.style.display = 'none'
  popupSpecificationsBody.style.display = 'none'

  if (initialFilterParticipations) {
    popupParticipationsBody.style.display = 'flex'
    popupRenderParticipationsSection(groupInfo, initialFilterParticipations, onlyGroupParticipationsSummaryGroup);
  }

  if (initialFilterSpecifications) {
    popupSpecificationsBody.style.display = 'flex'
    popupRenderSpecificationsSection(groupInfo, initialFilterSpecifications, onlyGroupParticipationsSummaryGroup);
  }
}

function popupSetupResizer(container) {
  let isDragging = false;
  let startX = 0;
  let leftPane = null;
  let rightPane = null;
  let startLeftWidth = 0;
  let startRightWidth = 0;
  let MIN_PAIN_WIDTH = 40;  // use this if css is not specified

  function startDrag(clientX, resizer) {
    if (!resizer) {
      return
    }
    isDragging = true;
    startX = clientX;

    leftPane = document.getElementById(resizer.dataset.left);
    rightPane = document.getElementById(resizer.dataset.right);

    const leftRect = leftPane.getBoundingClientRect();
    const rightRect = rightPane.getBoundingClientRect();

    startLeftWidth = leftRect.width;
    startRightWidth = rightRect.width;

    container.style.cursor = 'col-resize';
    container.style.userSelect = 'none';

    resizer.classList.add('dragging');
  }

  function doDrag(clientX) {
    if (!isDragging || !leftPane || !rightPane) return;

    const dx = clientX - startX;
    let newLeftWidth = startLeftWidth + dx;
    let newRightWidth = startRightWidth - dx;

    const leftMin = parseInt(getComputedStyle(leftPane).minWidth) || MIN_PAIN_WIDTH;
    const rightMin = parseInt(getComputedStyle(rightPane).minWidth) || MIN_PAIN_WIDTH;

    if (newLeftWidth < leftMin) {
      newLeftWidth = leftMin;
      newRightWidth = startLeftWidth + startRightWidth - newLeftWidth;
    }
    if (newRightWidth < rightMin) {
      newRightWidth = rightMin;
      newLeftWidth = startLeftWidth + startRightWidth - newRightWidth;
    }

    leftPane.style.width = newLeftWidth + 'px';
    rightPane.style.width = newRightWidth + 'px';
    leftPane.style.flex = 'none';
    rightPane.style.flex = 'none';
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    leftPane = null;
    rightPane = null;
    container.style.cursor = '';
    container.style.userSelect = '';

    container.querySelectorAll('.pane-resizer.dragging').forEach(r => r.classList.remove('dragging'));
  }

  container.querySelectorAll('.pane-resizer').forEach(r => {
    // マウス対応
    r.addEventListener('mousedown', e => {
      startDrag(e.clientX, r);
    });

    // タッチ対応
    r.addEventListener('touchstart', e => {
      e.preventDefault(); // スクロール防止
      startDrag(e.touches[0].clientX, r);
    }, { passive: false });

    r.addEventListener('pointerdown', startDrag);
  });

  // ドラッグ中
  function onMove(e) {
    // ドラッグしていないなら何もしない
    if (!isDragging) return;

    // touch のときだけスクロールを止める
    if (e.type === 'touchmove') {
      e.preventDefault(); // ← ドラッグ中のみ
    }

    const clientX =
      e.type === 'mousemove'
        ? e.clientX
        : e.touches[0].clientX;

    doDrag(clientX);
  }


  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);

  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);


  // ウィンドウリサイズ時に割合を維持
  window.addEventListener('resize', () => {
    const wrappers = container.querySelectorAll('.pane-wrapper');
    let sumPx = 0;

    wrappers.forEach(wrapper => {
      const w = wrapper.getBoundingClientRect().width;
      sumPx += w;
    })

    wrappers.forEach(wrapper => {
      const w = wrapper.getBoundingClientRect().width;
      const percent = (w / sumPx) * 100;
      wrapper.style.width = percent + '%';
      wrapper.style.flex = 'none';
    });
  });
}


// participationsシートの描画をまとめるサブ関数
async function popupRenderParticipationsSection(groupInfo, initialFilter = 'members', onlyGroupParticipationsSummaryGroup) {
  const participationsContent = document.getElementById('participationsContent')
  popupSetupResizer(participationsContent);

  const affiliationsTitle = document.querySelector('#membersList .title');
  const participantsTitle = document.querySelector('#participantsList .title');
  affiliationsTitle.textContent = 'Affiliations';
  if (groupInfo.isException) {
    affiliationsTitle.classList.add('exception');
  }
  participantsTitle.textContent = 'Participants';

  // setup toggleOnlyGoupparticipants
  const toggleBtn = document.getElementById('popupToggleOnlyGroupParticipations');
  const toggleBtnWrap = toggleBtn ? toggleBtn.parentElement : null;
  if (onlyGroupParticipationsSummaryGroup != null) {
    // Only Group Participantsトグルボタンの表示制御　toggleBtnWrap
    toggleBtnWrap.style.display = '';

    // トグルボタンのイベントハンドラ追加
    if (toggleBtn) {
      updateOnlyGroupParticipationsToggle(toggleBtn);
      toggleBtn.onclick = () => {
        flipOnlyGroupParticipationsToggle(toggleBtn)
        // update
        _popupRenderParticipations(groupInfo, onlyGroupParticipationsSummaryGroup);
      };
    }
  } else {
    toggleBtnWrap.style.display = 'none';
  }
  // setup filter buttons
  const filterButtons = document.querySelectorAll('#participationsButtonContainer .filter-btn');
  filterButtons.forEach(btn => {
    btn.onclick = () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const currentFilter = btn.dataset.filter;
      localStorage.setItem('popupParticipationsFilter', currentFilter);
      // update
      _popupRenderParticipations(groupInfo, onlyGroupParticipationsSummaryGroup);
    };
  });
  filterButtons.forEach(b => b.classList.remove('active'));
  const initialBtn = document.querySelector(`#participationsButtonContainer .filter-btn[data-filter="${initialFilter}"]`);
  if (initialBtn) {
    initialBtn.classList.add('active');
    localStorage.setItem('popupParticipationsFilter', initialFilter);
  }
  // the inital rendering 
  _popupRenderParticipations(groupInfo, onlyGroupParticipationsSummaryGroup);
}

function _popupRenderParticipations(groupInfo, onlyGroupParticipationsSummaryGroup) {
  console.log("_popupRenderParticipations called");
  const useGroupInfo = (getOnlyGroupParticipationsToggle() && onlyGroupParticipationsSummaryGroup)
    ? onlyGroupParticipationsSummaryGroup
    : groupInfo

  // リスト描画など重い処理は遅延実行
  requestAnimationFrame(() => { // requestAnimationFrame で1フレーム待つこれで「Popupの再描画→次のフレームで重い処理
    setTimeout(() => {
      _popupRenderParticipationsStats(useGroupInfo);
      _popupRenderParticipationsContent(useGroupInfo);
    }, 0); // setTimeout(..., 0)をrequestAnimationFrameの中で使うと、さらに「描画→次のタスク→重い処理」となり、より確実にUIが先に出ます
  });
}

// countsを使って数値を更新するサブ関数
function _popupRenderParticipationsStats(groupInfo) {
  const counts = {
    members: groupInfo.membersMap instanceof Map ? groupInfo.membersMap.size : 0,
    memberParticipants: groupInfo.memberParticipants ? groupInfo.memberParticipants.length : 0,
    invitedExperts: groupInfo.invitedExperts ? groupInfo.invitedExperts.length : 0,
    staffs: groupInfo.staffs ? groupInfo.staffs.length : 0,
    individuals: groupInfo.individuals ? groupInfo.individuals.length : 0,
    allParticipants: groupInfo.allParticipants ? groupInfo.allParticipants.length : 0
  };

  const filters = ['members', 'memberParticipants', 'invitedExperts', 'staffs', 'individuals', 'allParticipants'];
  filters.forEach(filter => {
    const btn = document.querySelector(`#participationsButtonContainer .filter-btn[data-filter="${filter}"]`);
    const countSpan = document.getElementById(`filterCount${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
    if (btn) {
      // 例外グループの場合はexceptionクラスを付与
      if (groupInfo.isException && (filter === 'members' || filter === 'memberParticipants' || filter === 'invitedExperts' || filter === 'individuals')) {
        btn.classList.add('exception');
      } else {
        btn.classList.remove('exception');
      }
    }
    if (countSpan) {
      countSpan.textContent = counts[filter];
    }
  });
}

function _popupRenderMembersListContent(groupInfo) {
  const membersListContent = document.getElementById('membersListContent');
  membersListContent.innerHTML = '';

  // ソートモード
  const sortMode = localStorage.getItem('popupMembersSortMode');

  // ソートボタン
  const sortBtnBar = document.querySelector('#membersList .list-sort-bar');
  const nameSortBtn = sortBtnBar?.querySelector('.name-sort-btn');
  const groupCountSortBtn = sortBtnBar?.querySelector('.gCount-sort-btn');
  const mpCountSortBtn = sortBtnBar?.querySelector('.mpCount-sort-btn');

  // member一覧取得
  const members = groupInfo.specsMap
    ? Array.from(groupInfo.membersMap.keys())
    : [];

  /* ===== ソート ===== */
  const sortedMembers = [...members].sort((a, b) => {
    const entryA = groupInfo.membersMap.get(a);
    const entryB = groupInfo.membersMap.get(b);

    if (sortMode === 'gCount') {
      const countA = entryA?.groupsSet?.size ?? 0;
      const countB = entryB?.groupsSet?.size ?? 0;
      if (countA != countB) {
        return countB - countA;
      }
    } else if (sortMode === 'mpCount') {
      const countA = entryA?.participants.length ?? 0;
      const countB = entryB?.participants.length ?? 0;
      if (countA != countB) {
        return countB - countA;
      }
    }
    // num or count with equals
    return (entryA?.title || '').localeCompare(entryB?.title || '');
  });



  // ソートボタン状態
  if (sortBtnBar) {
    nameSortBtn?.classList.toggle('active', sortMode === 'name');
    groupCountSortBtn?.classList.toggle('active', sortMode === 'gCount');
    mpCountSortBtn?.classList.toggle('active', sortMode === 'mpCount');
  }

  /* ===== 描画 ===== */
  sortedMembers.forEach((affUrl, index) => {
    const entry = groupInfo.membersMap.get(affUrl);

    const item = document.createElement('div');
    item.className = 'list-item list-item--member';

    if (groupInfo.isException) {
      item.classList.add('exception');
    }

    const gCount = entry?.groupsSet?.size ?? 0;
    const mpCount = entry?.participants.length ?? 0;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = entry.title;
    nameSpan.title = entry.title;

    const gCountSpan = document.createElement('span');
    gCountSpan.className = 'item-number';
    gCountSpan.textContent = gCount;

    const mpCountSpan = document.createElement('span');
    mpCountSpan.className = 'item-number';
    mpCountSpan.textContent = mpCount;

    item.appendChild(nameSpan);
    item.appendChild(gCountSpan);
    item.appendChild(mpCountSpan);

    item.dataset.affUrl = affUrl;
    item.dataset.index = index;

    item.addEventListener('click', async () => {
      document.querySelectorAll('#membersListContent .list-item.selected')
        .forEach(el => el.classList.remove('selected'));

      item.classList.add('selected');
      await _popupRenderParticipantsForMember(groupInfo, affUrl);
    });

    membersListContent.appendChild(item);
  });
}


function _popupRenderMembersList(groupInfo) {
  const membersTitle = document.querySelector('#membersList .title');
  membersTitle.textContent = `Affiliations: ${groupInfo.membersMap.size}`;

  let sortBtnBar = document.querySelector('#membersList .list-sort-bar');
  if (sortBtnBar) {
    const nameSortBtn = sortBtnBar.querySelector('.name-sort-btn');
    const gCountSortBtn = sortBtnBar.querySelector('.gCount-sort-btn');
    const mpCountSortBtn = sortBtnBar.querySelector('.mpCount-sort-btn');
    // ボタンイベント
    // ボタンイベント
    nameSortBtn.addEventListener('click', () => {
      nameSortBtn.classList.add('active');
      gCountSortBtn.classList.remove('active');
      mpCountSortBtn.classList.remove('active');
      localStorage.setItem('popupMembersSortMode', 'name');
      _popupRenderMembersListContent(groupInfo);
    });
    gCountSortBtn.addEventListener('click', () => {
      gCountSortBtn.classList.add('active');
      nameSortBtn.classList.remove('active');
      mpCountSortBtn.classList.remove('active');
      localStorage.setItem('popupMembersSortMode', 'gCount');
      _popupRenderMembersListContent(groupInfo);
    });
    mpCountSortBtn.addEventListener('click', () => {
      nameSortBtn.classList.add('active');
      gCountSortBtn.classList.remove('active');
      mpCountSortBtn.classList.remove('active');

      localStorage.setItem('popupMembersSortMode', 'mpCount');
      _popupRenderMembersListContent(groupInfo);
    });
  }

  let sortMode = localStorage.getItem('popupMembersSortMode');
  if (!sortMode) {
    sortMode = 'name';  // initial
    localStorage.setItem('popupMembersSortMode', sortMode);
  }
  const sortButtons = document.querySelectorAll('#membersList .sort-btn');
  sortButtons.forEach(b => {
    b.disabled = false;
    b.classList.remove('active');
  });
  const activeButton = document.querySelector(`#specificationsFilter .filter-btn[data-filter="${sortMode}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  // 初期表示
  _popupRenderMembersListContent(groupInfo);
}

// 共通化: 参加者リスト＋numGroups＋ソートUI
function _popupRenderParticipantsList(list) {
  // タイトル右にソートボタン
  const sortBtnBar = document.querySelector('#participantsList .list-sort-bar')
  // ソートボタンイベント
  if (sortBtnBar) {
    const nameSortBtn = sortBtnBar.querySelector('.name-sort-btn');
    const gCountSortBtn = sortBtnBar.querySelector('.gCount-sort-btn');
    nameSortBtn.onclick = () => {
      localStorage.setItem('popupParticipantsSortMode', 'name');
      nameSortBtn.classList.add('active');
      gCountSortBtn.classList.remove('active');
      _popupRenderParticipantsListContent(list);;
    };
    gCountSortBtn.onclick = () => {
      nameSortBtn.classList.remove('active');
      gCountSortBtn.classList.add('active');

      localStorage.setItem('popupParticipantsSortMode', 'num');
      _popupRenderParticipantsListContent(list);
    };
  }

  let sortMode = localStorage.getItem('popupParticipantsSortMode');
  if (!sortMode) {
    sortMode = 'name';    // inital
    localStorage.setItem('popupParticipantsSortMode', sortMode);
  }
  const sortButtons = document.querySelectorAll('#participantsList .sort-btn');
  sortButtons.forEach(b => {
    b.disabled = false;
    b.classList.remove('active');
  });
  const activeButton = document.querySelector(`#participantsList .sort-btn[data-sort="${sortMode}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  _popupRenderParticipantsListContent(list);
}

async function _popupRenderUserDetails(userHref, userName) {
  const userDetailsContent = document.getElementById('userDetailsContent');
  userDetailsContent.style.overflowY = 'auto';

  if (!userHref) {
    userDetailsContent.innerHTML = '<p>No user data available</p>';
    return;
  }

  let user = getDataEntry(userHref); // w3c-api.jsの関数
  const fetchAlways = false; // true only for debuging
  if (!user || fetchAlways) {
    // ローカルにデータがない場合
    const dl = document.createElement('dl');
    dl.innerHTML = `<dt>Name:</dt><dd>${escapeHtml(userName || 'Unknown')}</dd>`;
    dl.innerHTML += `<p>Detailed user information not available locally.</p>`;

    const fetchBtn = document.createElement('button');
    fetchBtn.textContent = 'Fetch from W3C API';
    fetchBtn.onclick = async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching...';
      try {
        const userByApi = await fetchDataEntryAsync(userHref);  // w3c-api.jsの関数
        if (userByApi) {
          renderUserDetailsContent(userByApi, true); // useFetchDataAsync
        } else {
          fetchBtn.textContent = 'Failed to fetch';
        }
      } catch (e) {
        fetchBtn.textContent = 'Error';
      }
    };
    dl.appendChild(fetchBtn);

    userDetailsContent.innerHTML = '';
    userDetailsContent.appendChild(dl);
    return;
  }

  await renderUserDetailsContent(user, false);  // not useFetchDataAsync
}


// 詳細描画ロジックを分離
async function renderUserDetailsContent(user, useFetchDataAsync = false) {
  const userDetailsContent = document.getElementById('userDetailsContent');
  const dl = document.createElement('dl');

  // 基本情報
  if (user.name) dl.innerHTML += `<dt>Name:</dt><dd>${escapeHtml(user.name)}</dd>`;
  if (user.given) dl.innerHTML += `<dt>Given Name:</dt><dd>${escapeHtml(user.given)}</dd>`;
  if (user.family) dl.innerHTML += `<dt>Family Name:</dt><dd>${escapeHtml(user.family)}</dd>`;
  if (user.email) dl.innerHTML += `<dt>Email:</dt><dd>${escapeHtml(user.email)}</dd>`;
  if (user['work-title']) dl.innerHTML += `<dt>Work Title:</dt><dd>${escapeHtml(user['work-title'])}</dd>`;
  if (user.biography) dl.innerHTML += `<dt>Biography:</dt><dd>${escapeHtml(user.biography)}</dd>`;
  if (user['country-code']) dl.innerHTML += `<dt>Country:</dt><dd>${escapeHtml(user['country-code'])}</dd>`;
  if (user['country-division']) dl.innerHTML += `<dt>Division:</dt><dd>${escapeHtml(user['country-division'])}</dd>`;
  if (user.city) dl.innerHTML += `<dt>City:</dt><dd>${escapeHtml(user.city)}</dd>`;

  // Connected Accounts（オブジェクト/配列両対応）
  if (user['connected-accounts']) {
    let accounts = user['connected-accounts'];
    // オブジェクトの場合は配列化
    if (!Array.isArray(accounts)) accounts = Object.values(accounts);
    if (accounts.length > 0) {
      dl.innerHTML += `<dt class='acount'>Connected Accounts:</dt>`;
      accounts.forEach(account => {
        let icon = '';
        if (account.service === 'github' && account['profile-picture']) {
          icon = `<img src='${escapeHtml(account['profile-picture'])}' alt='github'>`;
        }
        dl.innerHTML += `<dd class='${account.service}'>${icon}<a href="${escapeHtml(account.href)}" target="_blank">${escapeHtml(account.nickname || account.name || account.id || 'N/A')}</a> (${escapeHtml(account.service || 'Unknown')})</dd>`;
      });
    }
  }

  // Discriminator
  if (user.discr) {
    dl.innerHTML += `<dt>Discriminator:</dt><dd>${escapeHtml(user.discr)}</dd>`;
  }

  // Affiliations名取得（getDataのみ使用、配列化対応）
  let affiliationsList = [];
  if (user._links && user._links.affiliations && user._links.affiliations.href) {
    try {
      const affApiRes = useFetchDataAsync ? await fetchDataEntryAsync(user._links.affiliations.href) : getDataEntry(user._links.affiliations.href);
      let affArr = [];
      if (affApiRes && affApiRes._links && affApiRes._links.affiliations) {
        // affiliationsが数値キー付きオブジェクトの場合はObject.valuesで配列化
        affArr = Object.values(affApiRes._links.affiliations);
      }
      // affiliationsListにtitleまたはhrefを格納
      for (const aff of affArr) {
        const affDetailsApiRes = useFetchDataAsync ? await fetchDataEntryAsync(aff.href) : getDataEntry(aff.href);
        let className = 'non-member';
        let label = '';
        if (affDetailsApiRes['is-member']) {
          className = 'member';
          label = ' (M)';
        } else if (affDetailsApiRes['is-member-association']) {
          className = 'member-association';
          label = ' (MA)';
        } else if (affDetailsApiRes['is-partner-member']) {
          className = 'partner-member';
          label = ' (PM)';
        } else if (affDetailsApiRes.name === 'W3C') {
          className = 'staff';
        }
        affiliationsList.push({
          name: affDetailsApiRes.name,
          className: className,
          label: label
        });
      }
    } catch (e) {
      console.error('Affiliations fetch error:', e);
    }
  }
  if (affiliationsList.length > 0) {
    dl.innerHTML += `
    <dt>Affiliations:</dt>
    ${affiliationsList.map(a => `<dd class='aff ${a.className}'>${escapeHtml(a.name)}</dd>`).join('')}
  `;
  }
  // Groups名取得（getDataのみ使用、配列化対応）
  let groupsList = [];
  if (user._links && user._links.groups && user._links.groups.href) {
    try {
      const href = user._links.groups.href;
      const grpApiRes = useFetchDataAsync ? await fetchDataEntryAsync(href) : getDataEntry(href);
      if (grpApiRes && grpApiRes._links && grpApiRes._links.groups) {
        let grpArr = grpApiRes._links.groups;
        if (!Array.isArray(grpArr)) {
          grpArr = Object.values(grpArr);
        }
        groupsList = grpArr.map(a => a.title || a.href).filter(Boolean);
      }
    } catch (e) {
      console.error('Groups fetch error:', e);
    }
  }
  if (groupsList.length > 0) {
    {
      dl.innerHTML += `
    <dt>Groups:</dt>
    ${groupsList.map(g => `<dd>${escapeHtml(g)}</dd>`).join('')}
  `;
    }
  }

  userDetailsContent.innerHTML = '';
  userDetailsContent.appendChild(dl);

}

async function _popupRenderParticipantsForMember(groupInfo, affUrl) {
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  participantsListContent.innerHTML = '';
  userDetailsContent.innerHTML = '<p>Select a participant to view detail</p>';

  const participants = groupInfo.membersMap.get(affUrl)?.participants || [];

  _popupRenderParticipantsList(participants);
}

function getParticipantItemHeight() {
  // ダミー要素を作成
  const dummy = document.createElement('div');
  dummy.className = 'participant-item';
  dummy.style.visibility = 'hidden';
  dummy.style.position = 'absolute';
  dummy.textContent = 'Sample';
  document.body.appendChild(dummy);

  // 高さを取得
  const height = dummy.offsetHeight;

  // ダミー要素を削除
  document.body.removeChild(dummy);

  return height;
}


function _popupRenderParticipantsListContent(list) {
  const participantsListContent = document.getElementById('participantsListContent');

  // タイトル更新
  const participantsTitle = document.querySelector('#participantsList .title');
  participantsTitle.textContent = `Participants: ${list.length}`;

  const sortMode = localStorage.getItem('popupParticipantsSortMode');

  // 仮想リスト用パラメータ
  const rowHeight = getParticipantItemHeight(); // .list-item の高さ
  const buffer = 10;

  // 初期化
  participantsListContent.innerHTML = '';
  participantsListContent.scrollTop = 0;
  participantsListContent.style.position = 'relative';

  if (!list || list.length === 0) {
    participantsListContent.innerHTML =
      '<p class="item-list">No items available</p>';
    return;
  }

  /* ===== ソート ===== */
  const sortedList = [...list].sort((a, b) => {
    if (sortMode == 'num') {
      const diff = (b.numGroups || 0) - (a.numGroups || 0);
      if (diff != 0) {
        return diff
      }
    }
    // sortMode == 'name' or num with equals
    return (a.name || '').localeCompare(b.name || '');
  });

  /* ===== padding 取得 ===== */
  const containerStyle = window.getComputedStyle(participantsListContent);
  const paddingTop = parseInt(containerStyle.paddingTop, 10);
  const paddingBottom = parseInt(containerStyle.paddingBottom, 10);
  const paddingLeft = parseInt(containerStyle.paddingLeft, 10);
  const paddingRight = parseInt(containerStyle.paddingRight, 10);

  /* ===== spacer ===== */
  const spacer = document.createElement('div');
  spacer.className = 'virtual-list-spacer';
  spacer.style.position = 'absolute';
  spacer.style.top = paddingTop + 'px';
  spacer.style.left = paddingLeft + 'px';
  spacer.style.right = paddingRight + 'px';
  participantsListContent.appendChild(spacer);

  /* ===== 実体描画用 ===== */
  const listDiv = document.createElement('div');
  listDiv.className = 'virtual-list-content';
  listDiv.style.position = 'absolute';
  listDiv.style.left = paddingLeft + 'px';
  listDiv.style.right = paddingRight + 'px';
  listDiv.style.top = paddingTop + 'px';
  listDiv.style.bottom = paddingBottom + 'px';
  participantsListContent.appendChild(listDiv);

  /* ===== 初期 spacer 高さ ===== */
  const totalHeight = sortedList.length * rowHeight;
  spacer.style.height = Math.max(
    totalHeight + paddingBottom,
    participantsListContent.clientHeight
  ) + 'px';

  /* ===== 行更新 ===== */
  function updateVisibleRows() {
    const totalRows = sortedList.length;
    const viewportHeight = participantsListContent.clientHeight;
    const scrollTop = participantsListContent.scrollTop;
    const totalHeight = totalRows * rowHeight;

    let startIdx = 0;
    let endIdx = totalRows;

    if (totalHeight > viewportHeight) {
      startIdx = Math.floor(scrollTop / rowHeight) - buffer;
      startIdx = Math.max(0, startIdx);
      endIdx = Math.min(
        totalRows,
        startIdx + Math.ceil(viewportHeight / rowHeight) + buffer * 2
      );

      if (endIdx === totalRows && scrollTop + viewportHeight >= totalHeight - 1) {
        startIdx = Math.max(
          0,
          totalRows - Math.ceil(viewportHeight / rowHeight) - buffer
        );
      }

      spacer.style.height = totalHeight + 'px';
      listDiv.style.top = (startIdx * rowHeight + paddingTop) + 'px';
    } else {
      listDiv.style.top = paddingTop + 'px';
      spacer.style.height = viewportHeight + 'px';
    }

    listDiv.innerHTML = '';

    for (let i = startIdx; i < endIdx; i++) {
      const participant = sortedList[i];

      const item = document.createElement('div');
      item.className = 'list-item list-item-participant virtaul-list-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'item-name';
      nameSpan.textContent = participant.name || '';
      nameSpan.title = participant.name || '';

      // each list-item of the virtual list is the single line by the following styles.
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.display = 'block';     // ← virtual-list では重要
      nameSpan.style.width = '100%';         // ← 必須

      const numSpan = document.createElement('span');
      numSpan.className = 'item-number';
      numSpan.textContent = participant.numGroups ?? 0;

      item.appendChild(nameSpan);
      item.appendChild(numSpan);

      item.addEventListener('click', () => {
        document
          .querySelectorAll('#participantsListContent .list-item.selected')
          .forEach(el => el.classList.remove('selected'));

        item.classList.add('selected');

        if (participant.userHref) {
          _popupRenderUserDetails(participant.userHref, participant.name);
        }
      });

      listDiv.appendChild(item);
    }
  }

  /* ===== 初回 & scroll ===== */
  updateVisibleRows();
  participantsListContent.onscroll = updateVisibleRows;
}

async function _popupRenderParticipationsContent(groupInfo) {
  const currentFilter = localStorage.getItem('popupParticipationsFilter');
  const filterButtons = document.querySelectorAll('#participationsFilter .filter-btn');
  filterButtons.forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`#participationsFilter .filter-btn[data-filter="${currentFilter}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  if (currentFilter === 'members') {
    _popupRenderMembersList(groupInfo);
  } else {
    let list = undefined;
    let label = '';
    switch (currentFilter) {
      case 'memberParticipants':
        list = groupInfo.memberParticipants;
        label = "All Members' affilications";
        break;
      case 'invitedExperts':
        list = groupInfo.invitedExperts;
        label = 'W3C Invited Experts';
        break;
      case 'staffs':
        list = groupInfo.staffs;
        label = 'W3C';
        break;
      case 'individuals':
        list = groupInfo.individuals;
        label = 'Individuals';
        break;
      case 'allParticipants':
        list = groupInfo.allParticipants;
        label = 'All affilications';
        break;
      default:
        console.warn('_popupRenderParticipations Unknown filter:', currentFilter);
        list = [];
        label = 'unkown';
    }
    // render the left pane
    const membersTitle = document.querySelector('#membersList .title');
    membersTitle.textContent = `Affiliations`;
    const sortButtons = document.querySelectorAll('#membersList .sort-btn');
    sortButtons.forEach(b => {
      b.disabled = true;
    });
    const membersListContent = document.getElementById('membersListContent')
    membersListContent.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'list-item selected';
    div.textContent = label;
    if (groupInfo.isException) {
      div.classList.add('exception');
    }
    membersListContent.appendChild(div);
    // render the right pane
    const userDetailsContent = document.getElementById('userDetailsContent');
    userDetailsContent.innerHTML = '<p>Select a user to view the details</p>';
    // render the center pane
    _popupRenderParticipantsList(list);
  }
  const firstItem = membersListContent.querySelector('.list-item');
  if (firstItem) {
    firstItem.classList.add('selected');
    if (firstItem.dataset.affUrl) {
      await _popupRenderParticipantsForMember(groupInfo, firstItem.dataset.affUrl);
    }
  } else {
    const participantsListContent = document.getElementById('participantsListContent');
    const userDetailsContent = document.getElementById('userDetailsContent')
    participantsListContent.innerHTML = '<p class="list-item">No participant</p>';
    userDetailsContent.innerHTML = '<p>No information</p>';
  }
}

/*
  the following subfunctions for popupSpecificationsSheet as well as those for popupParticipationsSheet
*/

async function popupRenderSpecificationsSection(groupInfo, initialFilter = 'specifications', onlyGroupParticipationsSummaryGroup) {
  const specificationsContent = document.getElementById('specificationsContent')
  popupSetupResizer(specificationsContent);

  // setup Filter buttons
  const filterButtons = document.querySelectorAll('#specificationsButtonContainer .filter-btn');
  filterButtons.forEach(btn => {
    btn.onclick = () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const currentFilter = btn.dataset.filter;
      localStorage.setItem('popupSpecificationsFilter', currentFilter);
      // update
      _popupRenderSpecifications(groupInfo, onlyGroupParticipationsSummaryGroup);
    };
  });
  filterButtons.forEach(b => b.classList.remove('active'));
  const initialBtn = document.querySelector(`#specificationsButtonContainer .filter-btn[data-filter="${initialFilter}"]`);
  if (initialBtn) {
    initialBtn.classList.add('active');
    localStorage.setItem('popupSpecificationsFilter', initialFilter);
  }

  // the inital rendering 
  _popupRenderSpecifications(groupInfo, onlyGroupParticipationsSummaryGroup);
}

function _popupRenderSpecifications(groupInfo, onlyGroupParticipationsSummaryGroup) {
  const useGroupInfo = groupInfo

  // リスト描画など重い処理は遅延実行
  requestAnimationFrame(() => { // requestAnimationFrame で1フレーム待つこれで「Popupの再描画→次のフレームで重い処理
    setTimeout(() => {
      _popupRenderSpecificationsStats(useGroupInfo);
      _popupRenderSpecificationsContent(useGroupInfo);
    }, 0); // setTimeout(..., 0)をrequestAnimationFrameの中で使うと、さらに「描画→次のタスク→重い処理」となり、より確実にUIが先に出ます
  });
}

// countsを使って数値を更新するサブ関数
function _popupRenderSpecificationsStats(groupInfo) {
  const counts = {
    specifications: groupInfo.specsMap.size,
    recommendations: groupInfo.recommendations.length,
    candidateRecommendations: groupInfo.candidateRecommendations.length,
    draftStandards: groupInfo.draftStandards.length,
    retiredSpecs: groupInfo.retiredSpecs.length,
    otherSpecs: groupInfo.otherSpecs.length,
    allVersions: groupInfo.allVersions.length
  };

  const filters = ['specifications', 'recommendations', 'candidateRecommendations', 'draftStandards', 'retiredSpecs', 'otherSpecs', 'allVersions'];
  filters.forEach(filter => {
    const btn = document.querySelector(`#specificationsButtonContainer .filter-btn[data-filter="${filter}"]`);
    const countSpan = document.getElementById(`filterCount${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
    if (countSpan) {
      countSpan.textContent = counts[filter];
    }
  });
}

function _popupRenderSpecificationsListContent(groupInfo) {
  const specificationsListContent =
    document.getElementById('specificationsListContent');
  specificationsListContent.innerHTML = '';

  const sortMode = localStorage.getItem('popupSpecificationsSortMode');

  const specifications = groupInfo.specsMap
    ? Array.from(groupInfo.specsMap.keys())
    : [];

  /* ===== ソート ===== */
  const sortedSpecifications = [...specifications].sort((a, b) => {
    const entryA = groupInfo.specsMap.get(a);
    const entryB = groupInfo.specsMap.get(b);

    if (sortMode === 'name') {
      return (entryA.title || '').localeCompare(entryB.title || '');
    } else if (sortMode === 'stat') {
      const orderA = entryA.statusOrder?.order ?? 0;
      const orderB = entryB.statusOrder?.order ?? 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
    }

    // year  stat with eqauls and fallback
    const timeA = entryA.latestDate
      ? new Date(entryA.latestDate).getTime()
      : -Infinity;
    const timeB = entryB.latestDate
      ? new Date(entryB.latestDate).getTime()
      : -Infinity;

    return timeB - timeA;
  });

  /* ===== 描画 ===== */
  sortedSpecifications.forEach((specUrl, index) => {
    const entry = groupInfo.specsMap.get(specUrl);

    const item = document.createElement('div');
    item.className = 'list-item list-item-spec virtual-list-item';

    if (groupInfo.isException) {
      item.classList.add('exception');
    }

    if (entry.latestStatus === 'Retired') {
      item.classList.add('retired');
    }

    /* name */
    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = entry.title || '';
    nameSpan.title = entry.title || '';

    /* status */
    const statSpan = document.createElement('span');
    statSpan.className = 'item-stat';
    statSpan.textContent = entry.statusOrder?.shortName ?? '';

    /* year */
    const yearSpan = document.createElement('span');
    yearSpan.className = 'item-year';
    const date = entry.latestDate;
    yearSpan.textContent =
      typeof date === 'string' && /^\d{4}/.test(date)
        ? date.slice(0, 4)
        : '????';

    item.appendChild(nameSpan);
    item.appendChild(statSpan);
    item.appendChild(yearSpan);

    item.dataset.url = specUrl;
    item.dataset.index = index;

    item.addEventListener('click', async () => {
      document
        .querySelectorAll(
          '#specificationsListContent .list-item.selected'
        )
        .forEach(el => el.classList.remove('selected'));

      item.classList.add('selected');
      await _popupRenderVersionsForSpecification(groupInfo, specUrl);
    });

    specificationsListContent.appendChild(item);
  });
}

async function _popupRenderSpecificationsList(groupInfo) {
  const specificationsTitle = document.querySelector('#specificationsList .title');
  specificationsTitle.textContent = `Specifications: ${groupInfo.specsMap.size}`;

  const sortBtnBar = document.querySelector('#specificationsList .list-sort-bar')
  if (sortBtnBar) {
    const nameSortBtn = sortBtnBar.querySelector('.name-sort-btn');
    const statSortBtn = sortBtnBar.querySelector('.stat-sort-btn');
    const yearSortBtn = sortBtnBar.querySelector('.year-sort-btn');

    // ボタンイベント
    nameSortBtn.addEventListener('click', () => {
      nameSortBtn.classList.add('active');
      statSortBtn.classList.remove('active');
      yearSortBtn.classList.remove('active');

      localStorage.setItem('popupSpecificationsSortMode', 'name');
      _popupRenderSpecificationsListContent(groupInfo);
    });

    // ボタンイベント
    statSortBtn.addEventListener('click', () => {
      nameSortBtn.classList.remove('active');
      statSortBtn.classList.add('active');
      yearSortBtn.classList.remove('active');

      localStorage.setItem('popupSpecificationsSortMode', 'stat');
      _popupRenderSpecificationsListContent(groupInfo);
    });


    yearSortBtn.addEventListener('click', () => {
      nameSortBtn.classList.remove('active');
      statSortBtn.classList.remove('active');
      yearSortBtn.classList.add('active');

      localStorage.setItem('popupSpecificationsSortMode', 'year');
      _popupRenderSpecificationsListContent(groupInfo);
    });
  }

  let sortMode = localStorage.getItem('popupSpecificationsSortMode');
  if (!sortMode) {
    sortMode = 'name';    // initial
    localStorage.setItem('popupSpecificationsSortMode', sortMode);
  }
  const sortButtons = document.querySelectorAll('#specificationsList .sort-btn');
  sortButtons.forEach(b => {
    b.disabled = false;
    b.classList.remove('active');
  });
  const activeButton = document.querySelector(`#specificationsList .sort-btn[data-sort="${sortMode}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
  // 初期表示
  _popupRenderSpecificationsListContent(groupInfo);
}

// 共通化: 参加者リスト＋numGroups＋ソートUI
function _popupRenderVersionsList(list) {
  // タイトル右にソートボタン
  const sortBtnBar = document.querySelector('#versionsList .list-sort-bar')
  // ソートボタンイベント
  if (sortBtnBar) {
    const nameSortBtn = sortBtnBar.querySelector('.name-sort-btn');
    const statSortBtn = sortBtnBar.querySelector('.stat-sort-btn');
    const yearSortBtn = sortBtnBar.querySelector('.year-sort-btn');
    nameSortBtn.onclick = () => {
      nameSortBtn.classList.add('active');
      statSortBtn.classList.remove('active');
      yearSortBtn.classList.remove('active');

      localStorage.setItem('popupVersionsSortMode', 'name');
      _popupRenderVersionsListContent(list);;
    };
    statSortBtn.onclick = () => {
      nameSortBtn.classList.remove('active');
      statSortBtn.classList.add('active');
      yearSortBtn.classList.remove('active');

      localStorage.setItem('popupVersionsSortMode', 'stat');
      _popupRenderVersionsListContent(list);
    };
    yearSortBtn.onclick = () => {
      nameSortBtn.classList.remove('active');
      statSortBtn.classList.remove('active');
      yearSortBtn.classList.add('active');

      localStorage.setItem('popupVersionsSortMode', 'year');
      _popupRenderVersionsListContent(list);
    };
  }

  let sortMode = localStorage.getItem('popupVersionsSortMode');
  if (!sortMode) {
    sortMode = 'name';  // inital
    localStorage.setItem('popupVersionsSortMode', sortMode);
  }
  const sortButtons = document.querySelectorAll('#versionsList .sort-btn');
  sortButtons.forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`#versionsList  .sort-btn[data-sort="${sortMode}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  _popupRenderVersionsListContent(list);
}

function _popupRenderVersionDetails(versionEntry) {
  const versionDetailsContent = document.getElementById('versionDetailsContent');
  versionDetailsContent.style.overflowY = 'auto';

  let versionHref = versionEntry.url;
  if (!versionHref) {
    versionDetailsContent.innerHTML = '<p>No version data available</p>';
    return;
  }

  const versionTitle = versionEntry.title;
  let version = getDataEntry(versionHref); // w3c-api.jsの関数
  const fetchAlways = false; // true only for debuging
  if (!version || fetchAlways) {
    // ローカルにデータがない場合
    const dl = document.createElement('dl');
    dl.innerHTML = `<dt>Name:</dt><dd>${escapeHtml(versionTitle || 'Unknown')}</dd>`;
    dl.innerHTML += `<dt>Detailed user information not available locally.</dt>`;

    const fetchBtn = document.createElement('button');
    fetchBtn.textContent = 'Fetch from W3C API';
    fetchBtn.style.marginTop = '8px';
    fetchBtn.onclick = async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching...';
      try {
        const versionByApi = await fetchDataEntryAsync(versionHref);  // w3c-api.jsの関数
        if (versionByApi) {
          renderVersionDetailsContent(versionByApi, true); // useFetchDataAsync
        } else {
          fetchBtn.textContent = 'Failed to fetch';
        }
      } catch (e) {
        fetchBtn.textContent = 'Error';
      }
    };
    dl.appendChild(fetchBtn);

    versionDetailsContent.innerHTML = '';
    versionDetailsContent.appendChild(dl);
    return;
  }

  renderVersionDetailsContent(version, false);  // not useFetchDataAsync
}


// 詳細描画ロジックを分離
async function renderVersionDetailsContent(version, useFetchDataAsync = false) {
  const versionDetailsContent = document.getElementById('versionDetailsContent');
  const dl = document.createElement('dl');

  const successor = version._links?.['successor-version'] // This is the same as the VersionEntry.isOutdated
  const isRetired = version.status == 'Retired';

  // 基本情報
  if (version.title) dl.innerHTML += `<dt>Title:</dt><dd>${escapeHtml(version.title)}</dd>`;
  if (version.status) dl.innerHTML += `<dt>Status:</dt><dd>${escapeHtml(version.status)}<span class="retired">${isRetired ? " This spec is retired!" : ""}</span></dd>`;
  if (version.date) dl.innerHTML += `<dt>Date:</dt><dd>${escapeHtml(version.date)}<span class="outdated">${successor ? " This version is outdated!" : ""}</span></dd>`;
  if (typeof version.informative !== 'undefined') dl.innerHTML += `<dt>Informative:</dt><dd>${version.informative ? 'Yes' : 'No'}</dd>`;
  if (typeof version['rec-track'] !== 'undefined') dl.innerHTML += `<dt>REC Track:</dt><dd>${version['rec-track'] ? 'Yes' : 'No'}</dd>`;
  if (version.shortlink) dl.innerHTML += `<dt>Shortlink:</dt><dd><a href="${escapeHtml(version.shortlink)}" target="_blank" rel="noopener">${escapeHtml(version.shortlink)}</a></dd>`;
  if (version.uri) dl.innerHTML += `<dt>URI:</dt><dd><a href="${escapeHtml(version.uri)}" target="_blank" rel="noopener">${escapeHtml(version.uri)}</a></dd>`;
  if (version.description) dl.innerHTML += `<dt>Description:</dt><dd>${escapeHtml(version.description)}</dd>`;
  if (typeof version['editor-draft'] !== 'undefined') dl.innerHTML += `<dt>Editor Draft:</dt><dd><a href="${escapeHtml(version['editor-draft'])}" target="_blank" rel="noopener">${escapeHtml(version['editor-draft'])}</a></dd>`;
  if (typeof version['process-rules'] !== 'undefined') dl.innerHTML += `<dt>Process Rules:</dt><dd><a href="${escapeHtml(version['process-rules'])}" target="_blank" rel="noopener">${escapeHtml(version['process-rules'])}</a></dd>`;



  if (version._links?.supersedes) {
    const sup = version._links.supersedes;
    let supersedesTitles = [];
    if (sup && sup.href) {
      // まずキャッシュ取得、なければ必要に応じて fetch
      let supRes = getDataEntry(sup.href);
      if (!supRes && useFetchDataAsync) {
        try { supRes = await fetchDataEntryAsync(sup.href); } catch (e) { supRes = null; }
      }
      if (supRes && supRes.data && supRes.data._links && Array.isArray(supRes.data._links.supersedes)) {
        supersedesTitles = supRes.data._links.supersedes.map(s => s.title || s.href).filter(Boolean);
      }
      dl.innerHTML += `<dt>Supersedes:</dt><dd>${supersedesTitles.length ? supersedesTitles.map(t => escapeHtml(t)).join('<br>') : ''}</dd>`;
    }
  }
  if (version._links?.['superseded-by']) {
    const sup = version._links['superseded-by'];
    let supersededByTitles = [];
    if (sup && sup.href) {
      // まずキャッシュ取得、なければ必要に応じて fetch
      let supRes = getDataEntry(sup.href);
      if (!supRes && useFetchDataAsync) {
        try { supRes = await fetchDataEntryAsync(sup.href); } catch (e) { supRes = null; }
      }
      if (supRes && supRes.data && supRes.data._links && Array.isArray(supRes.data._links.supersedes)) {
        supersededByTitles = supRes.data._links['superseded-by'].map(s => s.title || s.href).filter(Boolean);
      }
      dl.innerHTML += `<dt>Superseded By:</dt><dd>${supersededByTitles.length ? supersededByTitles.map(t => escapeHtml(t)).join('<br>') : ''}</dd>`;
    }
  }

  versionDetailsContent.innerHTML = '';
  versionDetailsContent.appendChild(dl);
}

async function _popupRenderVersionsForSpecification(groupInfo, versionUrl) {
  const versionsListContent = document.getElementById('versionsListContent');
  const versionDetailsContent = document.getElementById('versionDetailsContent');
  versionsListContent.innerHTML = '';
  versionDetailsContent.innerHTML = '<p>Select a version to view the detail</p>';

  const versionEntry = groupInfo.specsMap && groupInfo.specsMap.get(versionUrl) || [];
  const versionEntries = versionEntry.versionEntries || [];

  _popupRenderVersionsList(versionEntries);
}


function getVersionItemHeight() {
  // ダミー要素を作成
  const dummy = document.createElement('div');
  dummy.className = 'version-item';
  dummy.style.visibility = 'hidden';
  dummy.style.position = 'absolute';
  dummy.textContent = 'Sample';
  document.body.appendChild(dummy);

  // 高さを取得
  const height = dummy.offsetHeight;

  // ダミー要素を削除
  document.body.removeChild(dummy);

  return height;
}

function _popupRenderVersionsListContent(list) {
  const versionsListContent = document.getElementById('versionsListContent');
  const versionsTitle = document.querySelector('#versionsList .title');

  versionsTitle.textContent = `Versions: ${list.length}`;

  let sortMode = localStorage.getItem('popupVersionsSortMode');
  let sortedList = [];
  // ソート
  if (sortMode === 'name') {
    sortedList = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortMode === 'stat') {
    sortedList = [...list].sort((a, b) => {
      const statA = a.statusOrder;
      const statB = b.statusOrder;
      if (statA.order !== statB.order) {
        return statA.order - statB.order;
      }
      const timeA = a.date ? new Date(a.date).getTime() : -Infinity;
      const timeB = b.date ? new Date(b.date).getTime() : -Infinity;
      return timeB - timeA;
    });
  } else {
    sortedList = [...list].sort((a, b) => {
      const timeA = a.date ? new Date(a.date).getTime() : -Infinity;
      const timeB = b.date ? new Date(b.date).getTime() : -Infinity;
      return timeB - timeA;
    });
  }

  // 仮想リスト用パラメータ
  const rowHeight = getVersionItemHeight(); // px
  const buffer = 10;    // 余分に描画する行数

  versionsListContent.innerHTML = '';
  versionsListContent.style.position = 'relative';
  versionsListContent.scrollTop = 0;  // interHTMLを変えてもスクロール位置は維持されるため、リセット

  const spacerStyle = window.getComputedStyle(versionsListContent);
  const spacerPaddingTop = parseInt(spacerStyle.paddingTop, 10);
  const spacerPaddingLeft = parseInt(spacerStyle.paddingLeft, 10);
  const spacerPaddingRight = parseInt(spacerStyle.paddingRight, 10);
  const spacerPaddingBottom = parseInt(spacerStyle.paddingBottom, 10);
  // spacerの位置・幅をpadding内に合わせる
  let spacer = document.createElement('div');
  spacer.className = 'virtual-list-spacer';
  spacer.style.position = 'absolute';
  spacer.style.top = spacerPaddingTop + 'px';
  spacer.style.left = spacerPaddingLeft + 'px';
  spacer.style.right = spacerPaddingRight + 'px';

  versionsListContent.appendChild(spacer);

  let listDiv = document.createElement('div');
  const listStyle = window.getComputedStyle(versionsListContent);
  const listDivPaddingTop = parseInt(listStyle.paddingTop, 10);
  const listDivPaddingLeft = parseInt(listStyle.paddingLeft, 10);
  const listDivPaddingRight = parseInt(listStyle.paddingRight, 10);
  const listDivPaddingBottom = parseInt(listStyle.paddingBottom, 10);
  listDiv.className = 'virtual-list-content';
  listDiv.style.position = 'absolute';
  listDiv.style.left = listDivPaddingLeft + 'px';
  listDiv.style.right = listDivPaddingRight + 'px';
  listDiv.style.top = listDivPaddingTop + 'px';
  listDiv.style.bottom = listDivPaddingBottom + 'px';
  versionsListContent.appendChild(listDiv);


  if (!list || list.length === 0) {
    versionsListContent.innerHTML =
      '<p class="list-item">No items available</p>';
    return;
  }

  // 仮想リストの高さを設定（表示領域より小さい場合はclientHeightを優先）
  const spacerHeight = Math.max(sortedList.length * rowHeight + spacerPaddingBottom, versionsListContent.clientHeight);
  spacer.style.height = spacerHeight + 'px';

  // スクロールイベントで表示範囲を更新
  function updateVisibleRows() {
    const totalRows = sortedList.length;
    const viewportHeight = versionsListContent.clientHeight;
    const totalHeight = totalRows * rowHeight;

    let startIdx = 0;
    let endIdx = totalRows;

    // console.log(`updateVisibleRows: buffer=${buffer}, totalRows=${totalRows}, viewportHeight=${viewportHeight}, totalHeight=${totalHeight} startIdx=${startIdx}, endIdx=${endIdx}`);
    // 短いリストは全件表示・スクロールバーなし
    if (totalHeight <= viewportHeight) {
      startIdx = 0;
      endIdx = totalRows;
      listDiv.style.top = listDivPaddingTop + 'px';
      spacer.style.height = viewportHeight + 'px';
    } else {
      const scrollTop = versionsListContent.scrollTop;
      startIdx = Math.floor(scrollTop / rowHeight) - buffer;
      startIdx = Math.max(0, startIdx);
      endIdx = Math.min(totalRows, startIdx + Math.ceil(viewportHeight / rowHeight) + 2 * buffer);

      // // 下端までスクロールしたときだけ、一番下で下端に揃うよう調整
      if (endIdx === totalRows && scrollTop + viewportHeight >= totalHeight - 1) {
        startIdx = Math.max(0, totalRows - Math.ceil(viewportHeight / rowHeight) - buffer);
        // console.log(`Adjusting for bottom alignment: startIdx=${startIdx}, endIdx=${endIdx}`);
      }
      spacer.style.height = totalHeight + 'px';
      listDiv.style.top = (startIdx * rowHeight + listDivPaddingTop) + 'px';
    }

    listDiv.innerHTML = '';
    for (let i = startIdx; i < endIdx; i++) {
      const versionEntry = sortedList[i];
      const div = document.createElement('div');
      div.className = 'list-item list-item-version virtual-list-item';

      // 名前
      const nameSpan = document.createElement('span');
      nameSpan.className = 'item-name';
      nameSpan.textContent = versionEntry.title;
      nameSpan.title = versionEntry.title;  // title will be shown on overflow
      //  Note each list-item of the virtual list is the single line by the following styles.
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.display = 'block';     // ← virtual-list では重要
      nameSpan.style.width = '100%';         // ← 必須

      // stat
      const shortName = versionEntry.statusOrder.shortName;
      const statSpan = document.createElement('span');
      statSpan.className = 'item-stat';
      statSpan.textContent = shortName;

      // date
      const date = versionEntry.date;
      const year = typeof date === 'string' && /^\d{4}/.test(date) ? date.slice(0, 4) : '????';
      const yearSpan = document.createElement('span');
      yearSpan.className = 'item-year';
      yearSpan.textContent = year;

      if (versionEntry.isOutdated) {
        div.classList.add('outdated');
      }
      if (versionEntry.status == 'Retired') {
        div.classList.add('retired');
      }

      div.appendChild(nameSpan);
      div.appendChild(statSpan);
      div.appendChild(yearSpan);

      // クリック時はonClickVersionを呼ぶ
      div.addEventListener('click', async () => {
        document
          .querySelectorAll('#versionsListContent .list-item.selected')
          .forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        if (versionEntry) {
          _popupRenderVersionDetails(versionEntry);
        }
      });

      listDiv.appendChild(div);
    }
  }
  // 初回描画
  updateVisibleRows();
  // スクロールイベント
  versionsListContent.onscroll = updateVisibleRows;
}

async function _popupRenderSpecificationsContent(groupInfo) {
  const currentFilter = localStorage.getItem('popupSpecificationsFilter');
  const filterButtons = document.querySelectorAll('#specificationsFilter .filter-btn');
  filterButtons.forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`#specificationsFilter .filter-btn[data-filter="${currentFilter}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }

  if (currentFilter === 'specifications') {
    await _popupRenderSpecificationsList(groupInfo);
  } else {
    let list = undefined;
    let label = '';
    switch (currentFilter) {
      case 'allVersions':
        list = groupInfo.allVersions || [];
        label = 'All Versions';
        break;
      case 'recommendations':
        list = groupInfo.recommendations || [];
        label = 'Recommendations';
        break;
      case 'candidateRecommendations':
        list = groupInfo.candidateRecommendations || [];
        label = 'Candidate Recommendations';
        break;
      case 'draftStandards':
        list = groupInfo.draftStandards || [];
        label = 'Draft Standards';
        break;
      case 'retiredSpecs':
        list = groupInfo.retiredSpecs || [];
        label = 'Retired Specs';
        break;
      case 'otherSpecs':
        list = groupInfo.otherSpecs || [];
        label = 'Other Specs';
        break;
      default:
        console.warn('_popupRenderSpecifications Unknown filter:', currentFilter);
        list = [];
        label = 'Unknown';
    }
    // render the left pane
    const specificationsTitle = document.querySelector('#specificationsList .title');
    specificationsTitle.textContents = 'Specifications'
    const sortButtons = document.querySelectorAll('#specificationsList .sort-btn');
    sortButtons.forEach(b => {
      b.disabled = true
    });
    const specificationsListContent = document.getElementById('specificationsListContent');
    specificationsListContent.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'list-item selected';
    div.textContent = label;
    specificationsListContent.appendChild(div);
    // render the right pane
    const versionDetailsContent = document.getElementById('versionDetailsContent');
    versionDetailsContent.innerHTML = '<p>Select a version to view the detail</p>';
    // render the center pane
    _popupRenderVersionsList(list);
  }

  const firstItem = specificationsListContent.querySelector('.list-item');
  if (firstItem) {
    firstItem.classList.add('selected');
    if (firstItem.dataset.url) {
      await _popupRenderVersionsForSpecification(groupInfo, firstItem.dataset.url);
    }
  } else {
    const versionsListContent = document.getElementById('versionsListContent');
    const versionDetailsContent = document.getElementById('versionDetailsContent');
    versionsListContent.innerHTML = '<p class="list-item">No version available</p>';
    versionDetailsContent.innerHTML = '<p>No information</p>';
  }
}