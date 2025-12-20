let groupsInfo = null; // 初回のみロード
let attachedSummaryHandler = false;
let attachedGroupsHandler = false;
let loadingDotsTimer = null;

async function renderDashboard() {
  const loadingStatus = document.getElementById('status');
  const groupsListDiv = document.getElementById('groupsList');
  const summarySection = document.getElementById('summarySection');
  const groupsSection = document.querySelector('.groupsSection');

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
    if (groupsInfo === null) {
      groupsInfo = await getAllGroupsInfo();
    }
    const groupsArray = groupsInfo.groupsArray;

    // フィルター・ソートはgroupsInfo.groupsArrayのみ参照
    const filterType = localStorage.getItem('groupTypeFilter') || 'wg';
    const filteredResults = filterType === 'all'
      ? groupsArray
      : groupsArray.filter(g => g.groupType === filterType);

    // ソート基準をlocalStorageから取得し、なければselectの値を使う
    const sortBySelect = document.getElementById('groupsListSortBy');
    let sortBy = localStorage.getItem('groupsListSortBy');
    if (!sortBy || !Array.from(sortBySelect.options).some(opt => opt.value === sortBy)) {
      sortBy = sortBySelect.value;
    } else {
      sortBySelect.value = sortBy;
    }
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
      case 'name':
      default:
        sortedResults = [...filteredResults].sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        break;
    }

    // Summary表示をサブ関数に分離
    _mainRenderSummary(groupsArray.length, groupsInfo.summaryGroup, groupsInfo.onlyGroupParticipationsSummaryGroup, groupsInfo.lastChecked);

    _mainRenderGroups({ groupsListDiv, groupsArray, sortedResults, filterType, sortBy });

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
});

document.getElementById('popupOverlay').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
});

document.getElementById('participationsPopupClose').addEventListener('click', () => {
  document.getElementById('participationsPopup').style.display = 'none';
  document.getElementById('participationsPopupOverlay').style.display = 'none';
  if (groupsInfo) {
    _mainRenderSummaryStats(groupsInfo.groupsArray.length, groupsInfo.summaryGroup, groupsInfo.onlyGroupParticipationsSummaryGroup);
  }
});

document.getElementById('participationsPopupOverlay').addEventListener('click', () => {
  document.getElementById('participationsPopup').style.display = 'none';
  document.getElementById('participationsPopupOverlay').style.display = 'none';
  if (groupsInfo) {
    _mainRenderSummaryStats(groupsInfo.groupsArray.length, groupsInfo.summaryGroup, groupsInfo.onlyGroupParticipationsSummaryGroup);
  }
});

// ESCキーでポップアップを閉じる
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popup = document.getElementById('popup');
    const popupOverlay = document.getElementById('popupOverlay');
    const participationsPopup = document.getElementById('participationsPopup');
    const participationsPopupOverlay = document.getElementById('participationsPopupOverlay');

    if (popup.style.display === 'block') {
      popup.style.display = 'none';
      popupOverlay.style.display = 'none';
    }
    if (participationsPopup.style.display === 'flex') {
      participationsPopup.style.display = 'none';
      participationsPopupOverlay.style.display = 'none';
    }
  }
});

renderDashboard() // ループ
// 以下は関数群

function getonlyGroupParticipationsToggle() {
  return localStorage.onlyGroupParticipations === 'true';   //
}

function fliponlyGroupParticipationsToggle(checkSpan) {
  const isChecked = !getonlyGroupParticipationsToggle();
  localStorage.onlyGroupParticipations = isChecked ? 'true' : 'false';  // 文字列で保存

  return updateonlyGroupParticipationsToggle(checkSpan);
}
function updateonlyGroupParticipationsToggle(checkSpan) {
  const isChecked = getonlyGroupParticipationsToggle();
  if (isChecked) {
    checkSpan.style.background = '#0969da';
    checkSpan.textContent = '✓';
    checkSpan.style.color = '#fff';
  } else {
    checkSpan.style.background = '#fff';
    checkSpan.textContent = ' ';
    checkSpan.style.color = '#0969da';
  }
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
  const checkSpan = document.getElementById('toggleOnlyGroupParticipationsCheck');
  if (toggleBtn && checkSpan) {
    updateonlyGroupParticipationsToggle(checkSpan);
    toggleBtn.onclick = () => {
      fliponlyGroupParticipationsToggle(checkSpan);
      // currentFilterを必ず維持して渡す
      _mainRenderSummaryStats(
        groupsInfo.groupsArray.length,
        groupsInfo.summaryGroup,
        groupsInfo.onlyGroupParticipationsSummaryGroup
      );
      _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
    };
  }
  // Summaryクリックイベント
  if (!attachedSummaryHandler) {
    attachedSummaryHandler = true;
    const summarySection = document.getElementById('summarySection');
    function handleSummaryClick(ev) {
      console.log('[summary click/touch]', ev.type, ev.target);
      const target = ev.target.closest('.clickable');
      if (!target) return;
      const summaryType = target.getAttribute('data-summary-type');
      if (summaryType) {
        let initialFilter = summaryType;
        popupParticipationsSheet(summaryGroup, initialFilter, onlyGroupParticipationsSummaryGroup);
      }
    }
    if (summarySection) {
      summarySection.addEventListener('click', handleSummaryClick);
      summarySection.addEventListener('touchend', handleSummaryClick);
    }
  }
  // 初期時点でのsummary値描画
  _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup);
}

function _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup = null) {
  const toggleOnlyGroupParticipations = getonlyGroupParticipationsToggle();
  const checkSpan = document.getElementById('toggleOnlyGroupParticipationsCheck');
  updateonlyGroupParticipationsToggle(checkSpan);

  const useGroupInfo = (toggleOnlyGroupParticipations && onlyGroupParticipationsSummaryGroup)
    ? onlyGroupParticipationsSummaryGroup
    : summaryGroup


  // summary値の更新
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

}

// groupsListDivの描画をまとめるサブ関数
function _mainRenderGroups({ groupsListDiv, groupsArray, sortedResults, filterType, sortBy }) {
  groupsListDiv.innerHTML = '';

  // 各タイプのグループ数を計算
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

  // カラム定義
  const filterTypeLabels = {
    'wg': 'Working Groups',
    'ig': 'Interest Groups',
    'cg': 'Community Groups',
    'tf': 'Task Forces',
    'other': 'Other Groups',
    'all': 'All Groups'
  };
  const filterTypeLabel = filterTypeLabels[filterType] || 'Groups';
  const columns = [
    { key: 'name', label: `${filterTypeLabel}: ${sortedResults.length}`, sortable: true },
    { key: 'members', label: 'M', sortable: true },
    { key: 'memberParticipants', label: 'MP', sortable: true },
    { key: 'invitedExperts', label: 'IE', sortable: true },
    { key: 'staffs', label: 'S', sortable: true },
    { key: 'individuals', label: 'Ind', sortable: true },
    { key: 'allParticipants', label: 'P', sortable: true },
    { key: 'charts', label: 'Charts', sortable: false }
  ];


  // ヘッダーコンテナを作成
  const headerContainer = document.createElement('div');
  headerContainer.className = 'table-header-container';

  // テーブル（ヘッダー用）を作成
  const headerTable = document.createElement('table');
  headerTable.className = 'groups-table groups-table-header';

  // テーブルヘッダー
  const thead = document.createElement('thead');

  // Column headers
  const headerRow = document.createElement('tr');

  columns.forEach((col, index) => {
    const th = document.createElement('th');

    // 列幅を明示的に設定
    if (index === 0) {
      th.style.width = 'auto';
    } else if (index >= 1 && index <= 6) {
      th.style.width = '50px';
      th.style.minWidth = '50px';
      th.style.maxWidth = '50px';
    } else if (index === 7) {
      th.style.width = 'auto';
      th.style.minWidth = '180px';
      th.style.maxWidth = '1fr';
    }

    // ソート矢印色を統一
    const arrowColorActive = '#0969da';
    const arrowColorInactive = '#bbb';

    if (col.key === 'name') {
      th.style.cursor = 'pointer';
      th.className = sortBy === 'name' ? 'sorted' : '';
      th.onclick = () => {
        document.getElementById('groupsListSortBy').value = col.key;
        localStorage.setItem('groupsListSortBy', col.key); //
        renderDashboard();
      };
      const arrow = document.createElement('span');
      arrow.className = 'sort-icon';
      arrow.innerHTML = '↓';
      arrow.style.marginLeft = '2px';
      arrow.style.color = sortBy === 'name' ? arrowColorActive : arrowColorInactive;
      th.innerHTML = '';
      th.appendChild(document.createTextNode(col.label));
      th.appendChild(arrow);
    } else if (col.sortable) {
      th.style.cursor = 'pointer';
      th.className = sortBy === col.key ? 'sorted' : '';
      th.onclick = () => {
        document.getElementById('groupsListSortBy').value = col.key;
        localStorage.setItem('groupsListSortBy', col.key); //
        renderDashboard();
      };
      const arrow = document.createElement('span');
      arrow.className = 'sort-icon';
      arrow.innerHTML = '↓';
      arrow.style.marginLeft = '2px';
      arrow.style.color = sortBy === col.key ? arrowColorActive : arrowColorInactive;
      th.innerHTML = '';
      th.appendChild(document.createTextNode(col.label));
      th.appendChild(arrow);
    } else if (col.key === 'charts') {
      th.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 2px 3px; align-items: center; font-size: 0.8em; line-height: 1.2; min-height: 1.5em;">
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; background-color: #0969da;"></div>
            <span>M</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; background-color: #1f883d;"></div>
            <span>MP</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; background-color: #bf8700;"></div>
            <span>IE</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; background-color: #cf222e;"></div>
            <span>S</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; background-color: #8250df;"></div>
            <span>Ind</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px;">
            <div style="width: 8px; height: 8px; border: 1px solid #000;"></div>
            <span>P = MP+IE+S+Ind</span>
          </div>
        </div>
      `;
      th.style.cursor = 'default';
    } else {
      th.textContent = col.label;
      th.style.cursor = 'default';
    }

    // 横幅小さい時に消すためのクラスを追加
    if (col.key === 'name') th.classList.add('col-name');
    if (col.key === 'members') th.classList.add('col-m');
    if (col.key === 'memberParticipants') th.classList.add('col-mp');
    if (col.key === 'invitedExperts') th.classList.add('col-ie');
    if (col.key === 'staffs') th.classList.add('col-s');
    if (col.key === 'individuals') th.classList.add('col-ind');
    if (col.key === 'allParticipants') th.classList.add('col-ap');
    if (col.key === 'charts') th.classList.add('col-charts');

    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  headerTable.appendChild(thead);
  headerContainer.appendChild(headerTable);
  groupsListDiv.appendChild(headerContainer);

  // フィルターボタンのイベントリスナーと値（数値）だけを設定
  setTimeout(() => {
    const groupTypeFilter = document.getElementById('groupTypeFilter');
    if (groupTypeFilter) {
      const currentFilterType = localStorage.getItem('groupTypeFilter') || 'wg';
      groupTypeFilter.querySelectorAll('.filter-btn').forEach(btn => {
        const type = btn.dataset.type;
        // ラベル部分はindex.htmlのまま、コロン以降の数値だけを更新
        const labelMatch = btn.textContent.match(/^(.+?):/);
        const label = labelMatch ? labelMatch[1] : btn.textContent;
        btn.textContent = `${label}: ${counts[type]}`;
        // アクティブクラスを設定
        if (btn.dataset.type === currentFilterType) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
        // イベントリスナーを設定
        btn.onclick = (e) => {
          e.stopPropagation();
          const type = btn.dataset.type;
          localStorage.setItem('groupTypeFilter', type);
          renderDashboard();
        };
      });
    }
  }, 0);

  // テーブルボディ描画をサブ関数に分離
  const bodyContainer = _mainRenderTableBody(groupsArray, sortedResults);
  groupsListDiv.appendChild(bodyContainer);
  // チャート描画はbodyContainer追加後に必ず呼ぶ
  _mainDrawGroupsCharts(sortedResults);

  if (!attachedGroupsHandler) {
    attachedGroupsHandler = true
    groupsListDiv.addEventListener('click', ev => {
      const target = ev.target.closest('.clickable');
      if (!target) return;

      const index = parseInt(target.getAttribute('data-index'));
      const type = target.getAttribute('data-type');
      if (isNaN(index) || !groupsArray[index]) return;

      // Membersの場合は特別な3ペインポップアップを表示
      let initialFilter = 'members';
      if (type === 'members') {
        initialFilter = 'members';
      } else if (type === 'allParticipants') {
        initialFilter = 'allParticipants';
      } else if (type === 'memberParticipants') {
        initialFilter = 'memberParticipants';
      } else if (type === 'invitedExperts') {
        initialFilter = 'invitedExperts';
      } else if (type === 'staffs') {
        initialFilter = 'staffs';
      } else if (type === 'individuals') {
        initialFilter = 'individuals';
      }
      popupParticipationsSheet(groupsArray[index], initialFilter);
    });
  }
}

function _mainRenderTableBody(groupsArray, sortedResults) {
  // ボディコンテナを作成
  const bodyContainer = document.createElement('div');
  bodyContainer.className = 'table-body-container';

  // テーブル（ボディ用）を作成
  const bodyTable = document.createElement('table');
  bodyTable.className = 'groups-table groups-table-body';

  // テーブルボディ
  const tbody = document.createElement('tbody');

  for (let i = 0; i < sortedResults.length; i++) {
    const g = sortedResults[i];
    const row = document.createElement('tr');

    // 元のインデックスを保存
    const originalIndex = groupsArray.indexOf(g);

    // グループ名
    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell col-name';
    if (g.homepage) {
      const link = document.createElement('a');
      link.href = g.homepage;
      link.target = '_blank';
      link.textContent = g.name;
      link.style.color = '#0366d6';
      link.style.textDecoration = 'none';
      nameCell.appendChild(link);
    } else {
      nameCell.textContent = g.name;
    }
    row.appendChild(nameCell);

    // Members
    const membersCell = document.createElement('td');
    membersCell.className = 'number-cell col-m';
    membersCell.style.width = '50px';
    membersCell.style.minWidth = '50px';
    membersCell.style.maxWidth = '50px';
    membersCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="members">${g.membersMap.size || 0}</span>`;
    row.appendChild(membersCell);

    // Member Participants
    const memberParticipantsCell = document.createElement('td');
    memberParticipantsCell.className = 'number-cell col-mp';
    memberParticipantsCell.style.width = '50px';
    memberParticipantsCell.style.minWidth = '50px';
    memberParticipantsCell.style.maxWidth = '50px';
    memberParticipantsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="memberParticipants">${g.memberParticipants.length || 0}</span>`;
    row.appendChild(memberParticipantsCell);

    // Invited Experts
    const invitedExpertsCell = document.createElement('td');
    invitedExpertsCell.className = 'number-cell col-ie';
    invitedExpertsCell.style.width = '50px';
    invitedExpertsCell.style.minWidth = '50px';
    invitedExpertsCell.style.maxWidth = '50px';
    invitedExpertsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="invitedExperts">${g.invitedExperts.length || 0}</span>`;
    if (g._error) {
      invitedExpertsCell.innerHTML += '<div class="error">(err)</div>';
    }
    row.appendChild(invitedExpertsCell);

    // Staffs
    const staffsCell = document.createElement('td');
    staffsCell.className = 'number-cell col-s';
    staffsCell.style.width = '50px';
    staffsCell.style.minWidth = '50px';
    staffsCell.style.maxWidth = '50px';
    staffsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="staffs">${g.staffs.length || 0}</span>`;
    row.appendChild(staffsCell);

    // Individuals
    const individualsCell = document.createElement('td');
    individualsCell.className = 'number-cell col-ind';
    individualsCell.style.width = '50px';
    individualsCell.style.minWidth = '50px';
    individualsCell.style.maxWidth = '50px';
    individualsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="individuals">${g.individuals.length || 0}</span>`;
    row.appendChild(individualsCell);

    // All Participants
    const allParticipantsCell = document.createElement('td');
    allParticipantsCell.className = 'number-cell col-ap';
    allParticipantsCell.style.width = '50px';
    allParticipantsCell.style.minWidth = '50px';
    allParticipantsCell.style.maxWidth = '50px';
    allParticipantsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="allParticipants">${g.allParticipants.length || 0}</span>`;
    row.appendChild(allParticipantsCell);

    // Charts Cell (上下配置)
    const chartsCell = document.createElement('td');
    chartsCell.className = 'charts-cell col-charts';
    chartsCell.style.width = 'auto';
    chartsCell.style.minWidth = '180px';
    chartsCell.style.maxWidth = '1fr';
    chartsCell.style.padding = '2px';

    // Members Chart
    const membersChartDiv = document.createElement('div');
    membersChartDiv.style.height = '16px';
    membersChartDiv.style.marginBottom = '0';
    const membersDiv = document.createElement('div');
    membersDiv.id = `members-chart-${i}`;
    membersDiv.className = 'chart-bar';
    membersChartDiv.appendChild(membersDiv);
    chartsCell.appendChild(membersChartDiv);

    // Participants Chart
    const participantsChartDiv = document.createElement('div');
    participantsChartDiv.style.height = '16px';
    const participantsDiv = document.createElement('div');
    participantsDiv.id = `participants-chart-${i}`;
    participantsDiv.className = 'chart-bar';
    participantsChartDiv.appendChild(participantsDiv);
    chartsCell.appendChild(participantsChartDiv);

    row.appendChild(chartsCell);
    tbody.appendChild(row);
  }

  bodyTable.appendChild(tbody);
  bodyContainer.appendChild(bodyTable);
  return bodyContainer;
}

function _mainDrawGroupsCharts(sortedResults) {
  // チャートを描画
  const maxMembers = Math.max(...sortedResults.map(g => g.membersMap instanceof Map ? g.membersMap.size : 0));
  const maxParticipants = Math.max(...sortedResults.map(g => Array.isArray(g.allParticipants) ? g.allParticipants.length : 0));
  // 両方のチャートで同じスケールを使用
  const maxScale = Math.max(maxMembers, maxParticipants);

  for (let i = 0; i < sortedResults.length; i++) {
    const g = sortedResults[i];
    // Members Chart
    const membersDiv = document.getElementById(`members-chart-${i}`);
    if (membersDiv) {
      const membersCount = g.membersMap instanceof Map ? g.membersMap.size : 0;
      _maindrawBarChart(membersDiv, [membersCount], ['#0969da'], maxScale);
    }
    // Participants Chart (Stacked: MP, IE, S, Ind, ソート順に応じて並び替え)
    const participantsDiv = document.getElementById(`participants-chart-${i}`);
    if (participantsDiv) {
      let stackOrder = [
        { key: 'memberParticipants', value: Array.isArray(g.memberParticipants) ? g.memberParticipants.length : 0, color: '#1f883d' },
        { key: 'invitedExperts', value: Array.isArray(g.invitedExperts) ? g.invitedExperts.length : 0, color: '#bf8700' },
        { key: 'staffs', value: Array.isArray(g.staffs) ? g.staffs.length : 0, color: '#cf222e' },
        { key: 'individuals', value: Array.isArray(g.individuals) ? g.individuals.length : 0, color: '#8250df' }
      ];
      const sortBy = document.getElementById('groupsListSortBy').value;
      const idx = stackOrder.findIndex(s => s.key === sortBy);
      if (idx > 0) {
        const [item] = stackOrder.splice(idx, 1);
        stackOrder.unshift(item);
      }
      _maindrawBarChart(
        participantsDiv,
        stackOrder.map(s => s.value),
        stackOrder.map(s => s.color),
        maxScale
      );
    }
  }
}

// 棒グラフを描画する関数
function _maindrawBarChart(container, values, colors, maxValue) {
  container.innerHTML = '';
  container.style.height = '16px';
  container.style.width = '100%';
  container.style.position = 'relative';
  container.style.background = '#f5f5f5';
  container.style.border = '1px solid #ddd';
  container.style.borderRadius = '2px';
  container.style.overflow = 'hidden';
  container.style.display = 'flex';
  container.style.alignItems = 'center';

  const isSingleBar = values.length === 1;
  const totalValue = values.reduce((sum, val) => sum + val, 0);

  // バーコンテナ
  const barContainer = document.createElement('div');
  barContainer.style.height = '100%';
  barContainer.style.position = 'relative';
  container.appendChild(barContainer);

  let totalBarWidthPercent = 0;

  if (isSingleBar) {
    // 単一バーの場合
    const value = values[0];
    if (value > 0) {
      const bar = document.createElement('div');
      const barWidthPercent = value / maxValue * 100;
      totalBarWidthPercent = barWidthPercent;
      bar.style.height = '100%';
      bar.style.width = '100%';
      bar.style.background = colors[0];
      barContainer.appendChild(bar);
    }
  } else {
    // スタックバーの場合（Pチャートの合計幅内で各スタックを分割）]
    totalBarWidthPercent = totalValue / maxValue * 100;
    let currentX = 0;
    values.forEach((value, index) => {
      if (value > 0) {
        const bar = document.createElement('div');
        // Pチャートの合計幅内で各スタックの幅を計算
        const barWidthPercent = value / totalValue * 100;
        bar.style.height = '100%';
        bar.style.width = barWidthPercent + '%';
        bar.style.background = colors[index];
        bar.style.position = 'absolute';
        bar.style.left = currentX + '%';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.justifyContent = 'center';
        bar.style.color = 'white';
        bar.style.fontSize = '8px';
        bar.style.fontWeight = 'bold';
        // バー幅が十分広い時のみ数字を表示
        if (value / maxValue >= 0.05) {
          bar.textContent = value;
        }
        barContainer.appendChild(bar);
        currentX += barWidthPercent;
      }
    });

  }

  // バーコンテナの幅をバーの実際の幅に設定（ピクセル単位）
  const containerWidth = container.offsetWidth;
  const barWidthPx = totalBarWidthPercent / 100 * containerWidth;
  barContainer.style.width = barWidthPx + 'px';

  // 右側に合計数を表示（バーコンテナのすぐ右側）
  if (totalValue > 0) {
    const label = document.createElement('div');
    label.style.marginLeft = '4px';
    label.style.marginRight = '8px'; // 右側にマージン追加
    label.style.color = '#000';
    label.style.fontSize = '8px';
    label.style.fontWeight = 'bold';
    label.style.flexShrink = '0';
    label.textContent = totalValue;
    container.appendChild(label);
  }
}

/* ##
 popupParticipationsSheet()でPopupを表示, 利用されるサブ関数の名前は’_poupup’で始まる
 ### */
async function popupParticipationsSheet(groupInfo, initialFilter = 'members', onlyGroupParticipationsSummaryGroup) {
  const popup = document.getElementById('participationsPopup');
  const overlay = document.getElementById('participationsPopupOverlay');
  const title = document.getElementById('participationsPopupTitle');
  const membersListContent = document.getElementById('membersListContent');
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');

  // まず枠だけ即時表示
  popup.style.display = 'flex';
  overlay.style.display = 'block';
  document.body.classList.add('modal-open');  // disable body scroll (i.e. behind popup)

  title.textContent = groupInfo.name;

  const affiliationsTitle = document.querySelector('#membersList h3');
  const participantsTitle = document.querySelector('#participantsList h3');
  affiliationsTitle.textContent = 'Affiliations';
  if (groupInfo.isException) {
    affiliationsTitle.classList.add('exception');
  }
  participantsTitle.textContent = 'allParticipants';

  const toggleBtn = document.getElementById('toggleOnlyGroupParticipationsPopup');
  const checkSpan = document.getElementById('toggleOnlyGroupParticipationsPopupCheck');
  const toggleBtnWrap = toggleBtn ? toggleBtn.parentElement : null;
  if (onlyGroupParticipationsSummaryGroup != null) {
    // Only Group Participantsトグルボタンの表示制御　toggleBtnWrap
    toggleBtnWrap.style.display = '';

    // トグルボタンのイベントハンドラ追加
    if (toggleBtn && checkSpan) {
      updateonlyGroupParticipationsToggle(checkSpan);
      toggleBtn.onclick = () => {
        fliponlyGroupParticipationsToggle(checkSpan)
        // シートを更新
        let currentFilter = localStorage.getItem('popupParticipationsFilter') || initialFilter;
        _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
      };
    }
  } else {
    toggleBtnWrap.style.display = 'none';
  }

  // localStorageからfilterを復元
  let currentFilter = localStorage.getItem('popupParticipationsFilter') || initialFilter;
  // フィルターボタンのイベントリスナー（静的HTML対応）
  const filterButtons = document.querySelectorAll('#participationsButtonContainer .filter-btn');
  filterButtons.forEach(btn => {
    btn.onclick = () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      localStorage.setItem('popupParticipationsFilter', currentFilter);
      _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
    };
  });
  // 初期activeボタン設定
  filterButtons.forEach(b => b.classList.remove('active'));
  const initialBtn = document.querySelector(`#participationsButtonContainer .filter-btn[data-filter="${currentFilter}"]`);
  if (initialBtn) initialBtn.classList.add('active');

  // 初期シートを表示
  _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, initialFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
}

function _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle) {
  console.log("_popupRenderSheet called");
  const useGroupInfo = (getonlyGroupParticipationsToggle() && onlyGroupParticipationsSummaryGroup)
    ? onlyGroupParticipationsSummaryGroup
    : groupInfo


  // リスト描画など重い処理は遅延実行
  requestAnimationFrame(() => { // requestAnimationFrame で1フレーム待つこれで「Popupの再描画→次のフレームで重い処理
    setTimeout(() => {
      // ステータス数値更新
      // console.log("_popupRenderParticipantsStats called");
      const startTime1 = performance.now();
      _popupRenderParticipantsStats(useGroupInfo);
      const startTime2 = performance.now();
      //console.log("_popupRenderMembersList called");
      _popupRenderFilteredList(useGroupInfo, currentFilter, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
      console.log(`_popupRenderParticipantsStats took ${performance.now() - startTime1} ms`);
      console.log(`_popupRenderFilteredList took ${performance.now() - startTime2} ms`);
      console.log("_popupRenderFilteredList completed");
    }, 0); // setTimeout(..., 0)をrequestAnimationFrameの中で使うと、さらに「描画→次のタスク→重い処理」となり、より確実にUIが先に出ます
  });
}

// countsを使って数値を更新するサブ関数
function _popupRenderParticipantsStats(groupInfo) {
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

async function _popupRenderMemberParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: groupInfo.memberParticipants || [],
    label: 'All Members',
    membersListContent,
    participantsListContent,
    userDetailsContent,
    affiliationsTitle,
    participantsTitle
  });
}
async function _popupRenderAllParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: groupInfo.allParticipants || [],
    label: 'All Affiliations',
    membersListContent,
    participantsListContent,
    userDetailsContent,
    affiliationsTitle,
    participantsTitle
  });
}

async function _popupRenderMembersList(groupInfo, membersListContent, affiliationsTitle) {
  const members = groupInfo.membersMap ? Array.from(groupInfo.membersMap.keys()) : [];
  // デフォルトは組織名順
  // filter切り替え時も毎回localStorageからsortModeを復元
  let sortMode = localStorage.getItem('popupMembersSortMode') || 'name';

  // --- タイトル右にソートボタン配置 ---
  // 既存のボタンがあれば削除
  let sortBtnBar = affiliationsTitle.querySelector('.aff-sort-btn-bar');
  if (sortBtnBar) affiliationsTitle.removeChild(sortBtnBar);
  sortBtnBar = document.createElement('span');
  sortBtnBar.className = 'aff-sort-btn-bar';
  sortBtnBar.style.display = 'inline-flex';
  sortBtnBar.style.gap = '2px';
  sortBtnBar.style.marginLeft = '8px';
  sortBtnBar.style.float = 'right';
  sortBtnBar.style.justifyContent = 'flex-end';

  // ボタン生成
  const nameSortBtn = document.createElement('button');
  nameSortBtn.className = 'aff-sort-btn active';
  nameSortBtn.style.fontSize = '11px';
  nameSortBtn.style.padding = '0 4px';
  nameSortBtn.style.lineHeight = '1.2';
  nameSortBtn.title = 'abc';

  const countSortBtn = document.createElement('button');
  countSortBtn.className = 'aff-sort-btn';
  countSortBtn.style.fontSize = '11px';
  countSortBtn.style.padding = '0 4px';
  countSortBtn.style.lineHeight = '1.2';
  countSortBtn.title = 'MP';

  // 矢印spanを分離して色を制御
  const nameArrow = document.createElement('span');
  nameArrow.innerHTML = '&#8595;';
  nameArrow.style.fontSize = '10px';
  nameArrow.style.verticalAlign = 'middle';
  nameArrow.style.marginLeft = '1px';

  const countArrow = document.createElement('span');
  countArrow.innerHTML = '&#8595;';
  countArrow.style.fontSize = '10px';
  countArrow.style.verticalAlign = 'middle';
  countArrow.style.marginLeft = '1px';

  nameSortBtn.innerHTML = '';
  nameSortBtn.appendChild(document.createTextNode('abc'));
  nameSortBtn.appendChild(nameArrow);

  countSortBtn.innerHTML = '';
  countSortBtn.appendChild(document.createTextNode('MP'));
  countSortBtn.appendChild(countArrow);

  sortBtnBar.appendChild(nameSortBtn);
  sortBtnBar.appendChild(countSortBtn);
  affiliationsTitle.appendChild(sortBtnBar);

  // グローバル関数として分離
  function _popupRenderMembersListContent({
    groupInfo,
    members,
    membersListContent,
    affiliationsTitle,
    sortBtnBar,
    sortMode,
    nameArrow,
    countArrow
  }) {
    let sortedMembers;
    // 既存リスト削除
    membersListContent.innerHTML = '';
    // ソート
    if (sortMode === 'name') {
      sortedMembers = [...members].sort((a, b) => a.localeCompare(b));
      if (nameArrow) nameArrow.style.color = '#0969da';
      if (countArrow) countArrow.style.color = '#bbb';
    } else {
      sortedMembers = [...members].sort((a, b) => {
        const countA = Array.isArray(groupInfo.membersMap.get(a)) ? groupInfo.membersMap.get(a).length : 0;
        const countB = Array.isArray(groupInfo.membersMap.get(b)) ? groupInfo.membersMap.get(b).length : 0;
        // 降順
        return countB - countA || a.localeCompare(b);
      });
      if (nameArrow) nameArrow.style.color = '#bbb';
      if (countArrow) countArrow.style.color = '#0969da';
    }
    sortedMembers.forEach((member, index) => {
      const div = document.createElement('div');
      div.className = 'member-item';
      if (groupInfo.isException) {
        div.classList.add('exception');
      }
      // 参加者数を取得
      const count = Array.isArray(groupInfo.membersMap.get(member)) ? groupInfo.membersMap.get(member).length : 0;
      // カスタムレイアウト: 名前左寄せ、MP数右寄せ、間隔広め、MP数は黒
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      // div.style.gap = '32px';
      // 名前（左寄せ）
      const nameSpan = document.createElement('span');
      nameSpan.className = 'span-name';
      nameSpan.textContent = member;
      nameSpan.style.textAlign = 'left';
      nameSpan.style.flex = '1';
      nameSpan.style.paddingRight = '16px';
      nameSpan.style.overflowWrap = 'anywhere';

      nameSpan.title = member;
      // バーチャルリストでは１行固定なので省略スタイルをここで追加
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';

      // MP数（右寄せ）
      const countSpan = document.createElement('span');
      countSpan.className = 'span-number';
      countSpan.textContent = count;
      countSpan.style.textAlign = 'right';
      countSpan.style.flex = '0 0 10px';
      countSpan.style.fontWeight = 'normal';
      countSpan.style.color = '#000';
      countSpan.style.fontSize = 'inherit';
      countSpan.style.fontFamily = 'inherit';
      div.appendChild(nameSpan);
      div.appendChild(countSpan);
      div.dataset.member = member;
      div.dataset.index = index;
      div.addEventListener('click', async () => {
        document.querySelectorAll('.member-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        await _popupRenderParticipantsForMember(groupInfo, member);
      });
      membersListContent.appendChild(div);
    });
    affiliationsTitle.textContent = `Affiliations: ${sortedMembers.length}`;
    affiliationsTitle.appendChild(sortBtnBar);
  }

  // ボタンイベント
  nameSortBtn.addEventListener('click', () => {
    sortMode = 'name';
    localStorage.setItem('popupMembersSortMode', sortMode);
    nameSortBtn.classList.add('active');
    countSortBtn.classList.remove('active');
    // popupParticipantsSortModeもグローバルに反映
    window.popupMembersSortMode = sortMode;
    _popupRenderMembersListContent({
      groupInfo,
      members,
      membersListContent,
      affiliationsTitle,
      sortBtnBar,
      sortMode,
      nameArrow,
      countArrow
    });
  });
  countSortBtn.addEventListener('click', () => {
    sortMode = 'count';
    localStorage.setItem('popupMembersSortMode', sortMode);
    countSortBtn.classList.add('active');
    nameSortBtn.classList.remove('active');
    // popupParticipantsSortModeもグローバルに反映
    window.popupMembersSortMode = sortMode;
    _popupRenderMembersListContent({
      groupInfo,
      members,
      membersListContent,
      affiliationsTitle,
      sortBtnBar,
      sortMode,
      nameArrow,
      countArrow
    });
  });

  // 初期表示
  _popupRenderMembersListContent({
    groupInfo,
    members,
    membersListContent,
    affiliationsTitle,
    sortBtnBar,
    sortMode,
    nameArrow,
    countArrow
  });
}

async function _popupRenderTypeList(groupInfo, typeKey, typeLabel, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: (typeKey === 'invitedExperts') ? (groupInfo.invitedExperts || []) :
      (typeKey === 'staffs') ? (groupInfo.staffs || []) :
        (typeKey === 'individuals') ? (groupInfo.individuals || []) : [],
    label: typeLabel,
    membersListContent,
    participantsListContent,
    userDetailsContent,
    affiliationsTitle,
    participantsTitle
  });
}

// 共通化: 参加者リスト＋numGroups＋ソートUI
function _popupRenderParticipantsList({ list, label, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle }) {
  // 左ペインタイトル
  const div = document.createElement('div');
  div.className = 'member-item selected';
  div.textContent = label;
  membersListContent.appendChild(div);
  participantsListContent.innerHTML = '';
  userDetailsContent.innerHTML = '<p style="font-size:14px; padding: 12px; color: #666;">Select a participant to view details</p>';

  // タイトル右にソートボタン
  let sortBtnBar = participantsTitle.querySelector('.part-sort-btn-bar');
  if (sortBtnBar) participantsTitle.removeChild(sortBtnBar);
  sortBtnBar = createParticipantsSortBar();
  participantsTitle.appendChild(sortBtnBar);

  renderParticipantsListWithSort({
    list,
    participantsListContent,
    participantsTitle,
    sortBtnBar,
    initialSortMode: 'name',
    onClickParticipant: async (participant, div) => {
      document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      if (participant.userHref) {
        await _popupRenderUserDetails(participant.userHref, participant.name);
      }
    }
  });
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

async function _popupRenderUserDetails(userHref, userName) {
  const userDetailsContent = document.getElementById('userDetailsContent');
  userDetailsContent.style.overflowY = 'auto';

  if (!userHref) {
    userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">No user data available</p>';
    return;
  }

  userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Loading...</p>';

  let user = window.getData ? window.getData(userHref) : null;
  const fetchAlways = true; // for debuging
  if (!user || fetchAlways) {
    // ローカルにデータがない場合
    const dl = document.createElement('dl');
    dl.style.padding = '0 12px 12px 12px';
    dl.style.fontSize = '14px';
    dl.innerHTML = `<dt>Name:</dt><dd>${escapeHtml(userName || 'Unknown')}</dd>`;
    dl.innerHTML += `<p style="margin-top: 12px; color: #999; font-size: 0.9em;">Detailed user information not available locally.</p>`;

    const fetchBtn = document.createElement('button');
    fetchBtn.textContent = 'Fetch from W3C API';
    fetchBtn.style.marginTop = '8px';
    fetchBtn.onclick = async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching...';
      try {
        const apiUser = window.fetchDataAsync ? await window.fetchDataAsync(userHref) : null;
        if (apiUser) {
          renderUserDetailsContent(apiUser, true); // useFetchDataAsync
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
async function renderUserDetailsContent(user, useFetchData = false) {
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
      dl.innerHTML += `<dt>Connected Accounts:</dt>`;
      accounts.forEach(account => {
        let icon = '';
        if (account.service === 'github' && account['profile-picture']) {
          icon = `<img src='${escapeHtml(account['profile-picture'])}' alt='github' style='height:16px;vertical-align:middle;margin-right:4px;'>`;
        }
        dl.innerHTML += `<dd>${icon}<a href="${escapeHtml(account.href)}" target="_blank">${escapeHtml(account.nickname || account.name || account.id || 'N/A')}</a> (${escapeHtml(account.service || 'Unknown')})</dd>`;
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
      const affApiRes = fetchDataAsync ? await window.fetchDataAsync(user._links.affiliations.href) : window.getData(user._links.affiliations.href);
      let affArr = [];
      if (affApiRes && affApiRes._links && affApiRes._links.affiliations) {
        // affiliationsが数値キー付きオブジェクトの場合はObject.valuesで配列化
        affArr = Object.values(affApiRes._links.affiliations);
      }
      // affiliationsListにtitleまたはhrefを格納
      affiliationsList = affArr.map(a => a.title || a.href).filter(Boolean);
    } catch (e) {
      console.error('Affiliations fetch error:', e);
    }
  }
  if (affiliationsList.length > 0) {
    dl.innerHTML += `<dt>Affiliations:</dt><dd>${affiliationsList.map(a => escapeHtml(a)).join('<br>')}</dd>`;
  }

  // Groups名取得（getDataのみ使用、配列化対応）
  let groupsList = [];
  if (user._links && user._links.groups && user._links.groups.href) {
    try {
      const href = user._links.groups.href;
      const grpApiRes = fetchDataAsync ? await window.fetchDataAsync(href) : window.getData(href);
      if (grpApiRes && grpApiRes._links && grpApiRes._links.groups) {
        let grpArr = grpApiRes._links.groups;
        if (!Array.isArray(grpArr)) {
          grpArr = Object.values(grpArr);
        }
        groupsList = await Promise.all(grpArr.map(async (g) => {
          const href = g.href;
          let groupObj;
          if (fetchDataAsync) {
            groupObj = await window.fetchDataAsync(href); // async
          } else {
            groupObj = window.getData(href); // sync
          }
          return groupObj && groupObj.data && groupObj.data.title ? groupObj.data.title : (g.title || g.href);
        }));
      }
    } catch (e) {
      console.error('Groups fetch error:', e);
    }
  }
  if (groupsList.length > 0) {
    dl.innerHTML += `<dt>Groups:</dt><dd>${groupsList.map(g => escapeHtml(g)).join('<br>')}</dd>`;
  }

  userDetailsContent.innerHTML = '';
  userDetailsContent.appendChild(dl);

}

async function _popupRenderParticipantsForMember(groupInfo, memberOrg) {
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  participantsListContent.innerHTML = '';
  userDetailsContent.innerHTML = '<p style="font-size:14px; padding: 12px; color: #666;">Select a participant to view detail</p>';

  const participants = groupInfo.membersMap && groupInfo.membersMap.get ? groupInfo.membersMap.get(memberOrg) || [] : [];
  const participantsTitle = document.querySelector('#participantsList h3');
  let sortBtnBar = participantsTitle.querySelector('.part-sort-btn-bar');
  if (sortBtnBar) participantsTitle.removeChild(sortBtnBar);
  sortBtnBar = createParticipantsSortBar();
  participantsTitle.appendChild(sortBtnBar);

  renderParticipantsListWithSort({
    list: participants,
    participantsListContent,
    participantsTitle,
    sortBtnBar,
    initialSortMode: 'name',
    onClickParticipant: async (participant, div) => {
      document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      if (participant.userHref) {
        await _popupRenderUserDetails(participant.userHref, participant.name);
      }
    }
  });
}

function createParticipantsSortBar() {
  const sortBtnBar = document.createElement('span');
  sortBtnBar.className = 'part-sort-btn-bar';
  sortBtnBar.style.display = 'inline-flex';
  sortBtnBar.style.gap = '2px';
  sortBtnBar.style.marginLeft = '8px';
  sortBtnBar.style.float = 'right';
  sortBtnBar.style.justifyContent = 'flex-end';

  const nameSortBtn = document.createElement('button');
  nameSortBtn.className = 'part-sort-btn name-sort-btn active';
  nameSortBtn.style.fontSize = '11px';
  nameSortBtn.style.padding = '0 4px';
  nameSortBtn.style.lineHeight = '1.2';
  nameSortBtn.title = 'name';

  const numGroupsSortBtn = document.createElement('button');
  numGroupsSortBtn.className = 'part-sort-btn numgroups-sort-btn';
  numGroupsSortBtn.style.fontSize = '11px';
  numGroupsSortBtn.style.padding = '0 4px';
  numGroupsSortBtn.style.lineHeight = '1.2';
  numGroupsSortBtn.title = 'number of groups';

  const nameArrow = document.createElement('span');
  nameArrow.className = 'name-arrow';
  nameArrow.innerHTML = '&#8595;';
  nameArrow.style.fontSize = '10px';
  nameArrow.style.verticalAlign = 'middle';
  nameArrow.style.marginLeft = '1px';

  const numGroupsArrow = document.createElement('span');
  numGroupsArrow.className = 'numgroups-arrow';
  numGroupsArrow.innerHTML = '&#8595;';
  numGroupsArrow.style.fontSize = '10px';
  numGroupsArrow.style.verticalAlign = 'middle';
  numGroupsArrow.style.marginLeft = '1px';

  nameSortBtn.appendChild(document.createTextNode('abc'));
  nameSortBtn.appendChild(nameArrow);

  numGroupsSortBtn.appendChild(document.createTextNode('G'));
  numGroupsSortBtn.appendChild(numGroupsArrow);

  sortBtnBar.appendChild(nameSortBtn);
  sortBtnBar.appendChild(numGroupsSortBtn);

  return sortBtnBar;
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

function renderParticipantsListWithSort({
  list,
  participantsListContent,
  participantsTitle,
  sortBtnBar,
  initialSortMode = 'name',
  onClickParticipant
}) {
  let sortMode = localStorage.getItem('popupParticipantsSortMode') || initialSortMode;
  let sortedList = [];

  // 仮想リスト用パラメータ
  const rowHeight = getParticipantItemHeight(); // px
  const buffer = 10;    // 余分に描画する行数

  // 仮想リスト用のラッパーdivを用意
  participantsListContent.innerHTML = '';
  participantsListContent.style.position = 'relative';
  participantsListContent.style.overflowY = 'auto';
  participantsListContent.style.height = '400px'; // 必要に応じて調整
  participantsListContent.scrollTop = 0;  // interHTMLを変えてもスクロール位置は維持されるため、リセット

  const spacerStyle = window.getComputedStyle(participantsListContent);
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

  participantsListContent.appendChild(spacer);

  let listDiv = document.createElement('div');
  const listStyle = window.getComputedStyle(participantsListContent);
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
  participantsListContent.appendChild(listDiv);

  function doRender() {
    if (!list || list.length === 0) {
      participantsListContent.innerHTML = '<p style="padding: 12px; color: #666; font-style: italic;">No items available</p>';
      return;
    }
    // ソート
    if (sortMode === 'name') {
      sortedList = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (sortBtnBar) {
        sortBtnBar.querySelector('.name-arrow').style.color = '#0969da';
        sortBtnBar.querySelector('.numgroups-arrow').style.color = '#bbb';
      }
    } else {
      sortedList = [...list].sort((a, b) => (b.numGroups || 0) - (a.numGroups || 0) || (a.name || '').localeCompare(b.name || ''));
      if (sortBtnBar) {
        sortBtnBar.querySelector('.name-arrow').style.color = '#bbb';
        sortBtnBar.querySelector('.numgroups-arrow').style.color = '#0969da';
      }
    }

    // 仮想リストの高さを設定（表示領域より小さい場合はclientHeightを優先）
    const spacerHeight = Math.max(sortedList.length * rowHeight + spacerPaddingBottom, participantsListContent.clientHeight);
    spacer.style.height = spacerHeight + 'px';

    // スクロールイベントで表示範囲を更新
    function updateVisibleRows() {
      const totalRows = sortedList.length;
      const viewportHeight = participantsListContent.clientHeight;
      const totalHeight = totalRows * rowHeight;

      let startIdx = 0;
      let endIdx = totalRows;

      // 短いリストは全件表示・スクロールバーなし
      if (totalHeight <= viewportHeight) {
        startIdx = 0;
        endIdx = totalRows;
        listDiv.style.top = listDivPaddingTop + 'px';
        spacer.style.height = viewportHeight + 'px';
      } else {
        const scrollTop = participantsListContent.scrollTop;
        startIdx = Math.floor(scrollTop / rowHeight) - buffer;
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(totalRows, startIdx + Math.ceil(viewportHeight / rowHeight) + 2 * buffer);

        // 一番下で下端に揃うよう調整
        if (endIdx === totalRows) {
          startIdx = Math.max(0, totalRows - Math.ceil(viewportHeight / rowHeight) - buffer);
        }
        spacer.style.height = totalHeight + 'px';
        listDiv.style.top = (startIdx * rowHeight + listDivPaddingTop) + 'px';
      }

      listDiv.innerHTML = '';
      for (let i = startIdx; i < endIdx; i++) {
        const participant = sortedList[i];
        const div = document.createElement('div');
        div.className = 'participant-item';

        // 名前
        const nameSpan = document.createElement('span');
        nameSpan.class = 'span-name';
        nameSpan.textContent = participant.name;
        // バーチャルリストでは１行固定なので省略スタイルをここで追加
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';

        // numGroups
        const numGroupsSpan = document.createElement('span');
        numGroupsSpan.class = 'span-number';
        numGroupsSpan.textContent = (participant.numGroups != null ? participant.numGroups : 0);

        div.appendChild(nameSpan);
        div.appendChild(numGroupsSpan);

        // クリック時はonClickParticipantを呼ぶ
        if (onClickParticipant) {
          div.addEventListener('click', () => onClickParticipant(participant, div));
        }
        listDiv.appendChild(div);
      }
    }


    // 初回描画
    updateVisibleRows();

    // スクロールイベント
    participantsListContent.onscroll = updateVisibleRows;

    // タイトル
    participantsTitle.textContent = `Participants: ${sortedList.length}`;
    participantsTitle.appendChild(sortBtnBar);
  }

  // ソートボタンイベント
  if (sortBtnBar) {
    const nameSortBtn = sortBtnBar.querySelector('.name-sort-btn');
    const numGroupsSortBtn = sortBtnBar.querySelector('.numgroups-sort-btn');
    nameSortBtn.onclick = () => {
      sortMode = 'name';
      localStorage.setItem('popupParticipantsSortMode', sortMode);
      nameSortBtn.classList.add('active');
      numGroupsSortBtn.classList.remove('active');
      doRender();
    };
    numGroupsSortBtn.onclick = () => {
      sortMode = 'numGroups';
      localStorage.setItem('popupParticipantsSortMode', sortMode);
      numGroupsSortBtn.classList.add('active');
      nameSortBtn.classList.remove('active');
      doRender();
    };
  }

  doRender();
}

async function _popupRenderFilteredList(
  groupInfo,
  currentFilter,
  membersListContent,
  participantsListContent,
  userDetailsContent,
  affiliationsTitle,
  participantsTitle
) {
  membersListContent.innerHTML = '';
  membersListContent.style.minWidth = '200px';
  const filterButtons = document.querySelectorAll('#participationsFilter .filter-btn');
  filterButtons.forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`#participationsFilter .filter-btn[data-filter="${currentFilter}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
  if (currentFilter === 'memberParticipants') {
    await _popupRenderMemberParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter === 'allParticipants') {
    await _popupRenderAllParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter === 'members') {
    await _popupRenderMembersList(groupInfo, membersListContent, affiliationsTitle);
  } else if (currentFilter == 'invitedExperts') {
    await _popupRenderTypeList(groupInfo, 'invitedExperts', 'W3C Invited Experts', membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter == 'staffs') {
    await _popupRenderTypeList(groupInfo, 'staffs', 'W3C', membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter == 'individuals') {
    await _popupRenderTypeList(groupInfo, 'individuals', 'Individuals', membersListContent, participantsListContent, userDetailsContent, affiliationsTitle, participantsTitle);
  } else {
    console.warn('_popupRenderSheet Unknown filter:', currentFilter);
  }
  const firstItem = membersListContent.querySelector('.member-item');
  if (firstItem) {
    firstItem.classList.add('selected');
    if (firstItem.dataset.member) {
      await _popupRenderParticipantsForMember(groupInfo, firstItem.dataset.member);
    } else if (firstItem.dataset.afftype) {
      firstItem.click();
    }
  } else {
    participantsListContent.innerHTML = '<p style="font-size:14px;padding: 12px; color: #666; font-style: italic;">No items available</p>';
    userDetailsContent.innerHTML = '<p style="font-size:14px; padding: 12px; color: #666;">Select a participant to view detail</p>';
  }
}