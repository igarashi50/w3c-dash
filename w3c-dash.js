let groupsInfo = null; // 初回のみロード
let attachedSummaryHandler = false;
let attachedGroupsHandler = false;

async function renderDashboard() {
  const loadingStatus = document.getElementById('status');
  const groupsDiv = document.getElementById('groups');

  if (loadingStatus) {
    loadingStatus.className = 'loading';
    loadingStatus.textContent = 'Loading W3C API data...';
  }

  groupsDiv.innerHTML = '';


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
    const sortBySelect = document.getElementById('sortBy');
    let sortBy = localStorage.getItem('sortBy');
    if (!sortBy || !Array.from(sortBySelect.options).some(opt => opt.value === sortBy)) {
      sortBy = sortBySelect.value;
    } else {
      sortBySelect.value = sortBy;
    }
    let sortedResults;
    switch (sortBy) {
      case 'name':
        sortedResults = [...filteredResults].sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        break;
      case 'allParticipants':
        sortedResults = [...filteredResults].sort((a, b) => (b.allParticipants.length || 0) - (a.allParticipants.length || 0));
        break;
      case 'memberParticipants':
        sortedResults = [...filteredResults].sort((a, b) => (b.memberParticipants.length || 0) - (a.memberParticipants.length || 0));
        break;
      case 'members':
        sortedResults = [...filteredResults].sort((a, b) => (b.membersMap.size || 0) - (a.membersMap.size || 0));
        break;
      case 'staffs':
        sortedResults = [...filteredResults].sort((a, b) => (b.staffs.length || 0) - (a.staffs.length || 0));
        break;
      case 'individuals':
        sortedResults = [...filteredResults].sort((a, b) => (b.individuals.length || 0) - (a.individuals.length || 0));
        break;
      case 'invitedExperts':
      default:
        sortedResults = [...filteredResults].sort((a, b) => (b.invitedExperts.length || 0) - (a.invitedExperts.length || 0));
        break;
    }

    // Summary表示をサブ関数に分離
    _mainRenderSummary(groupsArray.length, groupsInfo.summaryGroup, groupsInfo.onlyGroupParticipationsSummaryGroup, groupsInfo.lastChecked);

    _mainRenderGroups({ groupsDiv, groupsArray, sortedResults, filterType, sortBy });

    if (loadingStatus) {
      loadingStatus.className = '';
      loadingStatus.textContent = '';
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (loadingStatus) {
      loadingStatus.className = 'error';
      loadingStatus.textContent = `Error loading data: ${msg}`;
    }
    console.error(e);
  }
}

document.getElementById('sortBy').addEventListener('change', () => {
  const sortBy = document.getElementById('sortBy').value;
  localStorage.setItem('sortBy', sortBy);
  renderDashboard();
});
document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
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
  const toggleBtn = document.getElementById('toggleonlyGroupParticipations');
  const checkSpan = document.getElementById('toggleonlyGroupParticipationsCheck');
  if (toggleBtn && checkSpan) {
    updateonlyGroupParticipationsToggle(checkSpan);
    toggleBtn.onclick = () => {
      fliponlyGroupParticipationsToggle(checkSpan);
      _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup);
    };
  }
  // Summaryクリックイベント
  if (!attachedSummaryHandler) {
    attachedSummaryHandler = true;
    const summarySection = document.getElementById('summarySection');
    if (summarySection) {
      summarySection.addEventListener('click', ev => {
        const target = ev.target.closest('.clickable');
        if (!target) return;
        const summaryType = target.getAttribute('data-summary-type');
        if (summaryType) {
          let initialFilter = summaryType;
          popupParticipationsSheet(summaryGroup, initialFilter, onlyGroupParticipationsSummaryGroup);
        }
      });
    }
  }
  // 初期時点でのsummary値描画
  _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup);
}

function _mainRenderSummaryStats(groupCounts, summaryGroup, onlyGroupParticipationsSummaryGroup = null) {
  const toggleonlyGroupParticipations = getonlyGroupParticipationsToggle();
  const checkSpan = document.getElementById('toggleonlyGroupParticipationsCheck');
  updateonlyGroupParticipationsToggle(checkSpan);

  const useGroupInfo = (toggleonlyGroupParticipations && onlyGroupParticipationsSummaryGroup)
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

// groupsDivの描画をまとめるサブ関数
function _mainRenderGroups({ groupsDiv, groupsArray, sortedResults, filterType, sortBy }) {
  groupsDiv.innerHTML = '';

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
        document.getElementById('sortBy').value = 'name';
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
        document.getElementById('sortBy').value = col.key;
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
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  headerTable.appendChild(thead);
  headerContainer.appendChild(headerTable);
  groupsDiv.appendChild(headerContainer);

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
  groupsDiv.appendChild(bodyContainer);
  // チャート描画はbodyContainer追加後に必ず呼ぶ
  _mainDrawGroupsCharts(sortedResults);

  if (!attachedGroupsHandler) {
    attachedGroupsHandler = true
    groupsDiv.addEventListener('click', ev => {
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
    nameCell.className = 'group-name';
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
    membersCell.style.width = '50px';
    membersCell.style.minWidth = '50px';
    membersCell.style.maxWidth = '50px';
    membersCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="members">${g.membersMap.size || 0}</span>`;
    row.appendChild(membersCell);

    // Member Participants
    const memberParticipantsCell = document.createElement('td');
    memberParticipantsCell.style.width = '50px';
    memberParticipantsCell.style.minWidth = '50px';
    memberParticipantsCell.style.maxWidth = '50px';
    memberParticipantsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="memberParticipants">${g.memberParticipants.length || 0}</span>`;
    row.appendChild(memberParticipantsCell);

    // Invited Experts
    const invitedExpertsCell = document.createElement('td');
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
    staffsCell.style.width = '50px';
    staffsCell.style.minWidth = '50px';
    staffsCell.style.maxWidth = '50px';
    staffsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="staffs">${g.staffs.length || 0}</span>`;
    row.appendChild(staffsCell);

    // Individuals
    const individualsCell = document.createElement('td');
    individualsCell.style.width = '50px';
    individualsCell.style.minWidth = '50px';
    individualsCell.style.maxWidth = '50px';
    individualsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="individuals">${g.individuals.length || 0}</span>`;
    row.appendChild(individualsCell);

    // All Participants
    const allParticipantsCell = document.createElement('td');
    allParticipantsCell.style.width = '50px';
    allParticipantsCell.style.minWidth = '50px';
    allParticipantsCell.style.maxWidth = '50px';
    allParticipantsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="allParticipants">${g.allParticipants.length || 0}</span>`;
    row.appendChild(allParticipantsCell);

    // Charts Cell (上下配置)
    const chartsCell = document.createElement('td');
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
      const sortBy = document.getElementById('sortBy').value;
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
        // バー幅が十分広い場合のみ数字を表示
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
  const userDetailContent = document.getElementById('userDetailContent');

  title.textContent = groupInfo.name

  const affiliationsTitle = document.querySelector('#membersList h3');
  const participantsTitle = document.querySelector('#participantsList h3');
  affiliationsTitle.textContent = 'Affiliations';
  if (groupInfo.isException) {
    affiliationsTitle.classList.add('exception');
  }
  participantsTitle.textContent = 'allParticipants';

  const toggleBtn = document.getElementById('toggleonlyGroupParticipationsPopup');
  const checkSpan = document.getElementById('toggleonlyGroupParticipationsPopupCheck');
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
        _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
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
      // ソートを更新
      _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
    };
  });
  // 初期activeボタン設定
  filterButtons.forEach(b => b.classList.remove('active'));
  const initialBtn = document.querySelector(`#participationsButtonContainer .filter-btn[data-filter="${currentFilter}"]`);
  if (initialBtn) initialBtn.classList.add('active');

  // 初期シートを表示
  await _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);

  popup.style.display = 'flex';
  overlay.style.display = 'block';
}

async function _popupRenderSheet(groupInfo, onlyGroupParticipationsSummaryGroup, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle) {
  // トグルの値で使用するgroupInfoを切り替え
  const useGroupInfo = (getonlyGroupParticipationsToggle() && onlyGroupParticipationsSummaryGroup)
    ? onlyGroupParticipationsSummaryGroup
    : groupInfo

  // ステータス数値更新
  _popupRenderParticipantsStats(useGroupInfo);
  // 初期リストを表示
  await _popupRenderFilteredList(useGroupInfo, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
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

async function _popupRenderMemberParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: groupInfo.memberParticipants || [],
    label: 'All Members',
    membersListContent,
    participantsListContent,
    userDetailContent,
    affiliationsTitle,
    participantsTitle
  });
}
async function _popupRenderAllParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: groupInfo.allParticipants || [],
    label: 'All Affiliations',
    membersListContent,
    participantsListContent,
    userDetailContent,
    affiliationsTitle,
    participantsTitle
  });
}

async function _popupRenderMembersList(groupInfo, membersListContent, affiliationsTitle) {
  const members = groupInfo.membersMap ? Array.from(groupInfo.membersMap.keys()) : [];
  // デフォルトは組織名順
  // filter切り替え時も毎回localStorageからsortModeを復元
  let sortMode = localStorage.getItem('popupParticipationsSortMode') || 'name';
  let sortedMembers = [...members].sort((a, b) => a.localeCompare(b));

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
  nameSortBtn.title = '組織名順';

  const countSortBtn = document.createElement('button');
  countSortBtn.className = 'aff-sort-btn';
  countSortBtn.style.fontSize = '11px';
  countSortBtn.style.padding = '0 4px';
  countSortBtn.style.lineHeight = '1.2';
  countSortBtn.title = '参加者数順';

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
      div.style.gap = '32px';
      // 名前（左寄せ）
      const nameSpan = document.createElement('span');
      nameSpan.textContent = member;
      nameSpan.style.textAlign = 'left';
      nameSpan.style.flex = '1';
      nameSpan.style.paddingRight = '16px';
      nameSpan.style.overflowWrap = 'anywhere';
      // MP数（右寄せ）
      const countSpan = document.createElement('span');
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
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    nameSortBtn.classList.add('active');
    countSortBtn.classList.remove('active');
    // popupParticipantsSortModeもグローバルに反映
    window.popupParticipantsSortMode = sortMode;
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
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    countSortBtn.classList.add('active');
    nameSortBtn.classList.remove('active');
    // popupParticipantsSortModeもグローバルに反映
    window.popupParticipantsSortMode = sortMode;
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

async function _popupRenderTypeList(groupInfo, typeKey, typeLabel, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle) {
  _popupRenderParticipantsList({
    list: (typeKey === 'invitedExperts') ? (groupInfo.invitedExperts || []) :
      (typeKey === 'staffs') ? (groupInfo.staffs || []) :
        (typeKey === 'individuals') ? (groupInfo.individuals || []) : [],
    label: typeLabel,
    membersListContent,
    participantsListContent,
    userDetailContent,
    affiliationsTitle,
    participantsTitle
  });
}

// 共通化: 参加者リスト＋numGroups＋ソートUI
function _popupRenderParticipantsList({ list, label, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle }) {
  // 左ペインタイトル
  const div = document.createElement('div');
  div.className = 'member-item selected';
  div.textContent = label;
  membersListContent.appendChild(div);
  participantsListContent.innerHTML = '';
  userDetailContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';

  // タイトル右にソートボタン
  let sortBtnBar = participantsTitle.querySelector('.part-sort-btn-bar');
  if (sortBtnBar) participantsTitle.removeChild(sortBtnBar);
  sortBtnBar = document.createElement('span');
  sortBtnBar.className = 'part-sort-btn-bar';
  sortBtnBar.style.display = 'inline-flex';
  sortBtnBar.style.gap = '2px';
  sortBtnBar.style.marginLeft = '8px';
  sortBtnBar.style.float = 'right';
  sortBtnBar.style.justifyContent = 'flex-end';

  const nameSortBtn = document.createElement('button');
  nameSortBtn.className = 'part-sort-btn active';
  nameSortBtn.style.fontSize = '11px';
  nameSortBtn.style.padding = '0 4px';
  nameSortBtn.style.lineHeight = '1.2';
  nameSortBtn.title = 'name';

  const numGroupsSortBtn = document.createElement('button');
  numGroupsSortBtn.className = 'part-sort-btn';
  numGroupsSortBtn.style.fontSize = '11px';
  numGroupsSortBtn.style.padding = '0 4px';
  numGroupsSortBtn.style.lineHeight = '1.2';
  numGroupsSortBtn.title = 'number of groups';

  const nameArrow = document.createElement('span');
  nameArrow.innerHTML = '&#8595;';
  nameArrow.style.fontSize = '10px';
  nameArrow.style.verticalAlign = 'middle';
  nameArrow.style.marginLeft = '1px';

  const numGroupsArrow = document.createElement('span');
  numGroupsArrow.innerHTML = '&#8595;';
  numGroupsArrow.style.fontSize = '10px';
  numGroupsArrow.style.verticalAlign = 'middle';
  numGroupsArrow.style.marginLeft = '1px';

  nameSortBtn.innerHTML = '';
  nameSortBtn.appendChild(document.createTextNode('abc'));
  nameSortBtn.appendChild(nameArrow);

  numGroupsSortBtn.innerHTML = '';
  numGroupsSortBtn.appendChild(document.createTextNode('G'));
  numGroupsSortBtn.appendChild(numGroupsArrow);

  sortBtnBar.appendChild(nameSortBtn);
  sortBtnBar.appendChild(numGroupsSortBtn);
  participantsTitle.appendChild(sortBtnBar);

  // Participants用のソート状態をlocalStorageから復元
  let sortMode = localStorage.getItem('popupParticipantsSortMode') || 'name';
  function renderList() {
    participantsListContent.innerHTML = '';
    let sortedList;
    if (sortMode === 'name') {
      sortedList = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      nameArrow.style.color = '#0969da';
      numGroupsArrow.style.color = '#bbb';
    } else {
      sortedList = [...list].sort((a, b) => (b.numGroups || 0) - (a.numGroups || 0) || (a.name || '').localeCompare(b.name || ''));
      nameArrow.style.color = '#bbb';
      numGroupsArrow.style.color = '#0969da';
    }
    sortedList.forEach(participant => {
      const div = document.createElement('div');
      div.className = 'participant-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      div.style.gap = '16px';
      // 名前
      const nameSpan = document.createElement('span');
      nameSpan.textContent = participant.name;
      nameSpan.style.flex = '1';
      nameSpan.style.overflowWrap = 'anywhere';
      // numGroups
      const numGroupsSpan = document.createElement('span');
      numGroupsSpan.textContent = (participant.numGroups != null ? participant.numGroups : 0);
      numGroupsSpan.title = 'Number of groups';
      numGroupsSpan.style.fontSize = '0.9em';
      numGroupsSpan.style.color = '#888';
      numGroupsSpan.style.textAlign = 'right';
      numGroupsSpan.style.minWidth = '2em';
      div.appendChild(nameSpan);
      div.appendChild(numGroupsSpan);
      if (participant.userHref) {
        div.addEventListener('click', async () => {
          document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
          div.classList.add('selected');
          await _popupRenderUserDetail(participant.userHref, participant.name);
        });
      }
      participantsListContent.appendChild(div);
    });
    participantsTitle.textContent = `Participants: ${sortedList.length}`;
    participantsTitle.appendChild(sortBtnBar);
  }
  nameSortBtn.addEventListener('click', () => {
    sortMode = 'name';
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    nameSortBtn.classList.add('active');
    numGroupsSortBtn.classList.remove('active');
    renderList();
  });
  numGroupsSortBtn.addEventListener('click', () => {
    sortMode = 'numGroups';
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    numGroupsSortBtn.classList.add('active');
    nameSortBtn.classList.remove('active');
    renderList();
  });
  renderList();
}

async function _popupRenderFilteredList(groupInfo, currentFilter, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle) {
  membersListContent.innerHTML = '';
  membersListContent.style.minWidth = '200px';
  const filterButtons = document.querySelectorAll('#participationsFilter .filter-btn');
  filterButtons.forEach(b => b.classList.remove('active'));
  const activeButton = document.querySelector(`#participationsFilter .filter-btn[data-filter="${currentFilter}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
  if (currentFilter === 'memberParticipants') {
    await _popupRenderMemberParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter === 'allParticipants') {
    await _popupRenderAllParticipantsList(groupInfo, membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter === 'members') {
    await _popupRenderMembersList(groupInfo, membersListContent, affiliationsTitle);
  } else if (currentFilter == 'invitedExperts') {
    await _popupRenderTypeList(groupInfo, 'invitedExperts', 'W3C Invited Experts', membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter == 'staffs') {
    await _popupRenderTypeList(groupInfo, 'staffs', 'W3C', membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
  } else if (currentFilter == 'individuals') {
    await _popupRenderTypeList(groupInfo, 'individuals', 'Individuals', membersListContent, participantsListContent, userDetailContent, affiliationsTitle, participantsTitle);
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
    participantsListContent.innerHTML = '<p style="padding: 12px; color: #666; font-style: italic;">No items available</p>';
    userDetailContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view detail</p>';
  }
}


async function _popupRenderParticipantsForMember(groupInfo, memberOrg) {
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailContent = document.getElementById('userDetailContent');

  participantsListContent.innerHTML = '';
  userDetailContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view detail</p>';

  // membersMapから該当する組織のparticipantsを取得
  const participants = groupInfo.membersMap && groupInfo.membersMap.get ? groupInfo.membersMap.get(memberOrg) || [] : [];

  const participantsTitle = document.querySelector('#participantsList h3');
  // --- タイトル右にソートボタン配置 ---
  // 既存のボタンがあれば削除
  let sortBtnBar = participantsTitle.querySelector('.part-sort-btn-bar');
  if (sortBtnBar) participantsTitle.removeChild(sortBtnBar);
  sortBtnBar = document.createElement('span');
  sortBtnBar.className = 'part-sort-btn-bar';
  sortBtnBar.style.display = 'inline-flex';
  sortBtnBar.style.gap = '2px';
  sortBtnBar.style.marginLeft = '8px';
  sortBtnBar.style.float = 'right';
  sortBtnBar.style.justifyContent = 'flex-end';

  // ボタン生成
  const nameSortBtn = document.createElement('button');
  nameSortBtn.className = 'part-sort-btn active';
  nameSortBtn.style.fontSize = '11px';
  nameSortBtn.style.padding = '0 4px';
  nameSortBtn.style.lineHeight = '1.2';
  nameSortBtn.title = '名前順';

  const numGroupsSortBtn = document.createElement('button');
  numGroupsSortBtn.className = 'part-sort-btn';
  numGroupsSortBtn.style.fontSize = '11px';
  numGroupsSortBtn.style.padding = '0 4px';
  numGroupsSortBtn.style.lineHeight = '1.2';
  numGroupsSortBtn.title = 'グループ数順';

  // 矢印span
  const nameArrow = document.createElement('span');
  nameArrow.innerHTML = '&#8595;';
  nameArrow.style.fontSize = '10px';
  nameArrow.style.verticalAlign = 'middle';
  nameArrow.style.marginLeft = '1px';

  const numGroupsArrow = document.createElement('span');
  numGroupsArrow.innerHTML = '&#8595;';
  numGroupsArrow.style.fontSize = '10px';
  numGroupsArrow.style.verticalAlign = 'middle';
  numGroupsArrow.style.marginLeft = '1px';

  nameSortBtn.innerHTML = '';
  nameSortBtn.appendChild(document.createTextNode('abc'));
  nameSortBtn.appendChild(nameArrow);

  numGroupsSortBtn.innerHTML = '';
  numGroupsSortBtn.appendChild(document.createTextNode('G'));
  numGroupsSortBtn.appendChild(numGroupsArrow);

  sortBtnBar.appendChild(nameSortBtn);
  sortBtnBar.appendChild(numGroupsSortBtn);
  participantsTitle.appendChild(sortBtnBar);

  // ソートモード
  let sortMode = localStorage.getItem('popupParticipantsSortMode') || 'name';
  function renderList() {
    participantsListContent.innerHTML = '';
    let sortedParticipants;
    if (sortMode === 'name') {
      sortedParticipants = [...participants].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      nameArrow.style.color = '#0969da';
      numGroupsArrow.style.color = '#bbb';
    } else {
      sortedParticipants = [...participants].sort((a, b) => (b.numGroups || 0) - (a.numGroups || 0) || (a.name || '').localeCompare(b.name || ''));
      nameArrow.style.color = '#bbb';
      numGroupsArrow.style.color = '#0969da';
    }
    sortedParticipants.forEach(participant => {
      const div = document.createElement('div');
      div.className = 'participant-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      div.style.gap = '16px';
      // 名前
      const nameSpan = document.createElement('span');
      nameSpan.textContent = participant.name;
      nameSpan.style.flex = '1';
      nameSpan.style.overflowWrap = 'anywhere';
      // numGroups
      const numGroupsSpan = document.createElement('span');
      numGroupsSpan.textContent = (participant.numGroups != null ? participant.numGroups : 0);
      numGroupsSpan.title = 'Number of groups';
      numGroupsSpan.style.fontSize = '0.9em';
      numGroupsSpan.style.color = '#888';
      numGroupsSpan.style.textAlign = 'right';
      numGroupsSpan.style.minWidth = '2em';
      div.appendChild(nameSpan);
      div.appendChild(numGroupsSpan);
      if (participant.userHref) {
        div.addEventListener('click', async () => {
          document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
          div.classList.add('selected');
          await _popupRenderUserDetail(participant.userHref, participant.name);
        });
      }
      participantsListContent.appendChild(div);
    });
    participantsTitle.textContent = `Participants: ${sortedParticipants.length}`;
    participantsTitle.appendChild(sortBtnBar);
  }
  // ボタンイベント
  nameSortBtn.addEventListener('click', () => {
    sortMode = 'name';
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    // popupParticipantsSortModeもグローバルに反映
    window.popupParticipantsSortMode = sortMode;
    nameSortBtn.classList.add('active');
    numGroupsSortBtn.classList.remove('active');
    renderList();
  });
  numGroupsSortBtn.addEventListener('click', () => {
    sortMode = 'numGroups';
    localStorage.setItem('popupParticipantsSortMode', sortMode);
    // popupParticipantsSortModeもグローバルに反映
    window.popupParticipantsSortMode = sortMode;
    numGroupsSortBtn.classList.add('active');
    nameSortBtn.classList.remove('active');
    renderList();
  });
  // 初期表示
  renderList();
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

async function _popupRenderUserDetail(userHref, userName) {
  const userDetailContent = document.getElementById('userDetailContent');
  // スクロール可能にする（overflow）
  userDetailContent.style.overflowY = 'auto';

  if (!userHref) {
    userDetailContent.innerHTML = '<p style="padding: 12px; color: #666;">No user data available</p>';
    return;
  }

  userDetailContent.innerHTML = '<p style="padding: 12px; color: #666;">Loading...</p>';

  try {
    let user = window.findByDataUrl ? window.findByDataUrl(userHref) : null;

    if (!user) {
      // ユーザー詳細データが無い場合は基本情報のみ表示
      const dl = document.createElement('dl');
      dl.style.padding = '0 12px 12px 12px';
      dl.innerHTML = `<dt>Name</dt><dd>${escapeHtml(userName || 'Unknown')}</dd>`;
      dl.innerHTML += `<dt>User URL</dt><dd><a href="${escapeHtml(userHref)}" target="_blank">${escapeHtml(userHref)}</a></dd>`;
      dl.innerHTML += `<p style="margin-top: 12px; color: #999; font-size: 0.9em;">Detailed user information not available (member organization participant)</p>`;
      userDetailContent.innerHTML = '';
      userDetailContent.appendChild(dl);
      return;
    }

    const dl = document.createElement('dl');
    dl.style.padding = '0 12px 12px 12px';
    dl.style.fontSize = '14px';

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

    // Affiliations名取得（findDataByUrlのみ使用、配列化対応）
    let affiliationsList = [];
    if (user._links && user._links.affiliations && user._links.affiliations.href) {
      try {
        const affApiRes = window.findByDataUrl(user._links.affiliations.href);
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

    // Groups名取得（findDataByUrlのみ使用、配列化対応）
    let groupsList = [];
    if (user._links && user._links.groups && user._links.groups.href) {
      try {
        const grpApiRes = window.findByDataUrl(user._links.groups.href);
        if (grpApiRes && grpApiRes._links && grpApiRes._links.groups) {
          let grpArr = grpApiRes._links.groups;
          if (!Array.isArray(grpArr)) {
            grpArr = Object.values(grpArr);
          }
          groupsList = grpArr.map(g => {
            const groupObj = window.findByDataUrl(g.href);
            return groupObj && groupObj.data && groupObj.data.title ? groupObj.data.title : (g.title || g.href);
          });
        } else {
          console.warn('Groups structure unexpected:', grpApiRes);
        }
      } catch (e) {
        console.error('Groups fetch error:', e);
      }
    }
    if (groupsList.length > 0) {
      dl.innerHTML += `<dt>Groups:</dt><dd>${groupsList.map(g => escapeHtml(g)).join('<br>')}</dd>`;
    }

    userDetailContent.innerHTML = '';
    userDetailContent.appendChild(dl);

  } catch (e) {
    userDetailContent.innerHTML = `<p style="padding: 12px; color: #900;">Error: ${e.message}</p>`;
  }
}