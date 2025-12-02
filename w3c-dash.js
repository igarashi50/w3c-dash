function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showList(title, arr) {
  const popup = document.getElementById('popup');
  const titleEl = document.getElementById('popupTitle');
  const content = document.getElementById('popupContent');
  const sortedArr = arr.length ? [...arr].sort() : [];
  titleEl.textContent = title;
  content.textContent = sortedArr.length ? sortedArr.join('\n') : '(no items)';
  popup.style.display = 'block';
}

async function showMembersPopup(groupData, groupName) {
  const popup = document.getElementById('membersPopup');
  const title = document.getElementById('membersPopupTitle');
  const membersListContent = document.getElementById('membersListContent');
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  
  title.textContent = groupName;
  
  // メンバーリストを表示（名前でソート）
  membersListContent.innerHTML = '';
  const members = groupData.participantsList || [];
  const sortedMembers = [...members].sort((a, b) => a.localeCompare(b));
  
  sortedMembers.forEach((member, index) => {
    const div = document.createElement('div');
    div.className = 'member-item';
    div.textContent = member;
    div.dataset.member = member;
    div.dataset.index = index;
    div.addEventListener('click', async () => {
      // 選択状態を更新
      document.querySelectorAll('.member-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      
      // このメンバーのparticipationsを取得
      await showParticipantsForMember(groupData, member);
    });
    membersListContent.appendChild(div);
  });
  
  // デフォルトで最初のmemberを選択
  if (sortedMembers.length > 0) {
    const firstMember = membersListContent.querySelector('.member-item');
    if (firstMember) {
      firstMember.classList.add('selected');
      await showParticipantsForMember(groupData, sortedMembers[0]);
    }
  } else {
    participantsListContent.innerHTML = '<p style="padding: 12px; color: #666; font-style: italic;">No members available</p>';
    userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
  }
  
  popup.style.display = 'flex';
}

async function showParticipantsForMember(groupData, memberOrg) {
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  
  participantsListContent.innerHTML = '';
  userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
  
  // membersMapから該当する組織のparticipantsを取得
  const membersMap = groupData.membersMap || {};
  console.log('membersMap keys:', Object.keys(membersMap));
  console.log('Looking for member:', memberOrg);
  console.log('Found participants:', membersMap[memberOrg]);
  
  const participants = membersMap[memberOrg] || [];
  
  if (participants.length === 0) {
    participantsListContent.innerHTML = '<p style="padding: 12px; color: #666; font-style: italic;">No participants data available for this organization</p>';
    return;
  }
  
  // 名前でソート
  const sortedParticipants = [...participants].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  
  sortedParticipants.forEach(participant => {
    const div = document.createElement('div');
    div.className = 'participant-item';
    div.textContent = participant.name;
    if (participant.userHref) {
      div.addEventListener('click', async () => {
        document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        await showUserDetails(participant.userHref, participant.name);
      });
    }
    participantsListContent.appendChild(div);
  });
}

async function showUserDetails(userHref, userName) {
  const userDetailsContent = document.getElementById('userDetailsContent');
  
  if (!userHref) {
    userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">No user data available</p>';
    return;
  }
  
  userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Loading...</p>';
  
  try {
    // w3c-users.jsonから取得
    const usersData = await (await fetch('data/w3c-users.json')).json();
    const userData = usersData[userHref];
    
    if (!userData || !userData.data) {
      // ユーザー詳細データが無い場合は基本情報のみ表示
      const dl = document.createElement('dl');
      dl.style.padding = '12px';
      dl.innerHTML = `<dt>Name</dt><dd>${escapeHtml(userName || 'Unknown')}</dd>`;
      dl.innerHTML += `<dt>User URL</dt><dd><a href="${escapeHtml(userHref)}" target="_blank">${escapeHtml(userHref)}</a></dd>`;
      dl.innerHTML += `<p style="margin-top: 12px; color: #999; font-size: 0.9em;">Detailed user information not available (member organization participant)</p>`;
      userDetailsContent.innerHTML = '';
      userDetailsContent.appendChild(dl);
      return;
    }
    
    const user = userData.data;
    const dl = document.createElement('dl');
    dl.style.padding = '12px';
    
    if (user.name) {
      dl.innerHTML += `<dt>Name</dt><dd>${escapeHtml(user.name)}</dd>`;
    }
    if (user.given) {
      dl.innerHTML += `<dt>Given Name</dt><dd>${escapeHtml(user.given)}</dd>`;
    }
    if (user.family) {
      dl.innerHTML += `<dt>Family Name</dt><dd>${escapeHtml(user.family)}</dd>`;
    }
    if (user['connected-accounts'] && user['connected-accounts'].length > 0) {
      dl.innerHTML += `<dt>Connected Accounts</dt>`;
      user['connected-accounts'].forEach(account => {
        dl.innerHTML += `<dd>${escapeHtml(account.service || 'Unknown')}: ${escapeHtml(account.name || account.id || 'N/A')}</dd>`;
      });
    }
    if (user.description) {
      dl.innerHTML += `<dt>Description</dt><dd>${escapeHtml(user.description)}</dd>`;
    }
    
    userDetailsContent.innerHTML = '';
    userDetailsContent.appendChild(dl);
    
  } catch (e) {
    userDetailsContent.innerHTML = `<p style="padding: 12px; color: #900;">Error: ${e.message}</p>`;
  }
}

document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
});

document.getElementById('membersPopupClose').addEventListener('click', () => {
  document.getElementById('membersPopup').style.display = 'none';
});

let attachedHandler = false;
let groupsData = []; // グループデータを保存

async function loadGroups() {
  const status = document.getElementById('status');
  const groupsDiv = document.getElementById('groups');
  const summary = document.getElementById('summary');
  const legendDiv = document.getElementById('legend');
  
  groupsDiv.innerHTML = '';
  status.className = 'loading';
  status.textContent = 'Loading group data from w3c-groups.json...';

  try {
    const results = await getAllGroupsInfo();
    groupsData = results; // データを保存
    
    // グループタイプでフィルター
    const filterType = localStorage.getItem('groupTypeFilter') || 'wg';
    const filteredResults = filterType === 'all' 
      ? results 
      : results.filter(g => g.groupType === filterType);
    
    // ソート基準を取得
    const sortBy = document.getElementById('sortBy').value;
    let sortedResults;
    
    switch(sortBy) {
      case 'name':
        console.log('Sorting by name (A-Z)');
        sortedResults = [...filteredResults].sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        console.log('First 3 groups:', sortedResults.slice(0, 3).map(g => g.name));
        break;
      case 'participants':
        sortedResults = [...filteredResults].sort((a, b) => (b.totalParticipantsCount || 0) - (a.totalParticipantsCount || 0));
        break;
      case 'users':
        sortedResults = [...filteredResults].sort((a, b) => (b.usersCount || 0) - (a.usersCount || 0));
        break;
      case 'members':
        sortedResults = [...filteredResults].sort((a, b) => (b.membersCount || 0) - (a.membersCount || 0));
        break;
      case 'individuals':
        sortedResults = [...filteredResults].sort((a, b) => (b.individualsCount || 0) - (a.individualsCount || 0));
        break;
      case 'invited':
      default:
        sortedResults = [...filteredResults].sort((a, b) => (b.invitedCount || 0) - (a.invitedCount || 0));
        break;
    }

    status.className = '';
    status.textContent = `Loaded ${filteredResults.length} of ${results.length} groups (${filterType.toUpperCase()}).`;
    summary.textContent = `Showing ${filteredResults.length} groups — sorted by ${sortBy}. Click counts to see names.`;

    // レジェンドを一度だけ表示
    if (legendDiv.innerHTML === '') {
      legendDiv.innerHTML = `
        <div class="legend-item">
          <div class="legend-color" style="background-color: #0969da;"></div>
          <span><strong>M</strong> = Members</span>
        </div>
        <div class="legend-item">
          <span><strong>P</strong> = Participants = U + IE + Ind</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background-color: #1f883d;"></div>
          <span><strong>U</strong> = Users</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background-color: #bf8700;"></div>
          <span><strong>IE</strong> = Invited Experts</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background-color: #8250df;"></div>
          <span><strong>Ind</strong> = Individuals</span>
        </div>
      `;
      legendDiv.style.display = 'flex';
    }

    // ステータスとサマリーを更新
    status.textContent = `Loaded ${sortedResults.length} groups`;
    status.className = '';
    
    let totalInvited = 0;
    sortedResults.forEach(g => {
      totalInvited += (g.invitedCount || 0);
    });
    summary.innerHTML = `<strong>Total Invited Experts: ${totalInvited}</strong>`;

    groupsDiv.innerHTML = '';
    
    // テーブルを作成
    const table = document.createElement('table');
    table.className = 'groups-table';
    
    // テーブルヘッダー
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const columns = [
      { key: 'name', label: 'Group Name', sortable: true },
      { key: 'members', label: 'M', sortable: true },
      { key: 'participants', label: 'P', sortable: true },
      { key: 'users', label: 'U', sortable: true },
      { key: 'invited', label: 'IE', sortable: true },
      { key: 'individuals', label: 'Ind', sortable: true },
      { key: 'charts', label: 'Charts', sortable: false }
    ];
    
    columns.forEach(col => {
      const th = document.createElement('th');
      if (col.key === 'name') {
        // Group Nameカラムにソートとフィルターボタンを追加
        th.style.cursor = 'pointer';
        th.className = sortBy === 'name' ? 'sorted' : '';
        th.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div onclick="document.getElementById('sortBy').value='name';loadGroups();" style="cursor: pointer;">
              ${col.label}<span class="sort-icon">↓</span>
            </div>
            <div id="groupTypeFilter" style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button class="filter-btn" data-type="wg">WG</button>
              <button class="filter-btn" data-type="ig">IG</button>
              <button class="filter-btn" data-type="cg">CG</button>
              <button class="filter-btn" data-type="tf">TF</button>
              <button class="filter-btn" data-type="other">Other</button>
              <button class="filter-btn" data-type="all">All</button>
            </div>
          </div>
        `;
      } else if (col.sortable) {
        th.style.cursor = 'pointer';
        th.className = sortBy === col.key ? 'sorted' : '';
        th.onclick = () => {
          document.getElementById('sortBy').value = col.key;
          loadGroups();
        };
        th.innerHTML = `${col.label}<span class="sort-icon">↓</span>`;
      } else {
        th.textContent = col.label;
        th.style.cursor = 'default';
      }
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // フィルターボタンのイベントリスナー（テーブル再作成のたびに設定）
    setTimeout(() => {
      const groupTypeFilter = document.getElementById('groupTypeFilter');
      if (groupTypeFilter) {
        const currentFilterType = localStorage.getItem('groupTypeFilter') || 'wg';
        groupTypeFilter.querySelectorAll('.filter-btn').forEach(btn => {
          // アクティブクラスを設定
          if (btn.dataset.type === currentFilterType) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
          // イベントリスナーを設定
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = btn.dataset.type;
            localStorage.setItem('groupTypeFilter', type);
            loadGroups();
          });
        });
      }
    }, 0);
    
    // テーブルボディ
    const tbody = document.createElement('tbody');
    
    for (let i = 0; i < sortedResults.length; i++) {
      const g = sortedResults[i];
      const row = document.createElement('tr');
      
      // 元のインデックスを保存
      const originalIndex = results.indexOf(g);
      
      // グループ名
      const nameCell = document.createElement('td');
      nameCell.className = 'group-name';
      nameCell.textContent = g.name;
      row.appendChild(nameCell);
      
      // Members
      const membersCell = document.createElement('td');
      membersCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="participantsList">${g.membersCount || 0}</span>`;
      row.appendChild(membersCell);
      
      // Participants (Users + Invited Experts)
      const participantsCell = document.createElement('td');
      participantsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="totalParticipantsList">${g.totalParticipantsCount || 0}</span>`;
      row.appendChild(participantsCell);
      
      // Users
      const usersCell = document.createElement('td');
      usersCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="usersList">${g.usersCount || 0}</span>`;
      row.appendChild(usersCell);
      
      // Invited Experts
      const invitedCell = document.createElement('td');
      invitedCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="invited">${g.invitedCount || 0}</span>`;
      if (g._error) {
        invitedCell.innerHTML += '<div class="error">(err)</div>';
      }
      row.appendChild(invitedCell);
      
      // Individuals
      const individualsCell = document.createElement('td');
      individualsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="individuals">${g.individualsCount || 0}</span>`;
      row.appendChild(individualsCell);
      
      // Charts Cell (上下配置)
      const chartsCell = document.createElement('td');
      chartsCell.style.width = '180px';
      chartsCell.style.padding = '4px';
      
      // Members Chart
      const membersChartDiv = document.createElement('div');
      membersChartDiv.style.height = '35px';
      membersChartDiv.style.marginBottom = '0';
      const membersCanvas = document.createElement('canvas');
      membersCanvas.id = `members-chart-${i}`;
      membersChartDiv.appendChild(membersCanvas);
      chartsCell.appendChild(membersChartDiv);
      
      // Participants Chart
      const participantsChartDiv = document.createElement('div');
      participantsChartDiv.style.height = '35px';
      const participantsCanvas = document.createElement('canvas');
      participantsCanvas.id = `participants-chart-${i}`;
      participantsChartDiv.appendChild(participantsCanvas);
      chartsCell.appendChild(participantsChartDiv);
      
      row.appendChild(chartsCell);
      
      tbody.appendChild(row);
    }
    
    table.appendChild(tbody);
    groupsDiv.appendChild(table);
    
    // チャートを描画
    const maxMembers = Math.max(...sortedResults.map(g => g.membersCount || 0));
    const maxTotal = Math.max(...sortedResults.map(g => g.totalParticipantsCount || 0));
    // 両方のチャートで同じスケールを使用
    const maxScale = Math.max(maxMembers, maxTotal);
    
    console.log('Chart Debug:', {
      maxMembers,
      maxTotal,
      maxScale,
      firstGroup: {
        name: sortedResults[0]?.name,
        membersCount: sortedResults[0]?.membersCount,
        totalParticipantsCount: sortedResults[0]?.totalParticipantsCount
      }
    });
    
    for (let i = 0; i < sortedResults.length; i++) {
      const g = sortedResults[i];
      
      console.log(`Creating chart ${i} for`, g.name);
      
      // Members Chart
      const membersCanvas = document.getElementById(`members-chart-${i}`);
      console.log(`  members-chart-${i}:`, membersCanvas);
      if (membersCanvas) {
        // 既存のチャートを破棄
        const existingChart = Chart.getChart(membersCanvas);
        if (existingChart) {
          existingChart.destroy();
        }
        
        new Chart(membersCanvas, {
          type: 'bar',
          data: {
            labels: ['M'],
            datasets: [{
              label: 'Members',
              data: [g.membersCount || 0],
              backgroundColor: '#0969da',
              barThickness: 20
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { enabled: true },
              datalabels: {
                color: '#fff',
                font: {
                  weight: 'bold',
                  size: 10
                },
                formatter: (value) => value > 0 ? value : '',
                anchor: 'center',
                align: 'center'
              }
            },
            scales: {
              x: {
                display: false,
                beginAtZero: true,
                min: 0,
                max: maxScale,
                suggestedMax: maxScale
              },
              y: { 
                display: true,
                ticks: {
                  font: { size: 10, weight: 'bold' }
                }
              }
            }
          }
        });
      }
      
      // Participants Chart (Stacked: Users + Invited + Individuals)
      const participantsCanvas = document.getElementById(`participants-chart-${i}`);
      if (participantsCanvas) {
        // 既存のチャートを破棄
        const existingChart = Chart.getChart(participantsCanvas);
        if (existingChart) {
          existingChart.destroy();
        }
        
        new Chart(participantsCanvas, {
          type: 'bar',
          data: {
            labels: ['P'],
            datasets: [
              {
                label: 'Users',
                data: [g.usersCount || 0],
                backgroundColor: '#1f883d',
                barThickness: 20
              },
              {
                label: 'Invited Experts',
                data: [g.invitedCount || 0],
                backgroundColor: '#bf8700',
                barThickness: 20
              },
              {
                label: 'Individuals',
                data: [g.individualsCount || 0],
                backgroundColor: '#8250df',
                barThickness: 20
              }
            ]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { enabled: true },
              datalabels: {
                color: '#fff',
                font: {
                  weight: 'bold',
                  size: 10
                },
                formatter: (value) => value > 0 ? value : '',
                anchor: 'center',
                align: 'center'
              }
            },
            scales: {
              x: {
                stacked: true,
                display: false,
                beginAtZero: true,
                min: 0,
                max: maxScale,
                suggestedMax: maxScale
              },
              y: {
                stacked: true,
                display: true,
                ticks: {
                  font: { size: 10, weight: 'bold' }
                }
              }
            }
          }
        });
      }
    }

    if (!attachedHandler) {
      attachedHandler = true;
      groupsDiv.addEventListener('click', ev => {
        const target = ev.target.closest('.clickable');
        if (!target) return;
        const index = parseInt(target.getAttribute('data-index'));
        const type = target.getAttribute('data-type');
        if (isNaN(index) || !groupsData[index]) return;
        
        // Membersの場合は特別な3ペインポップアップを表示
        if (type === 'participantsList') {
          showMembersPopup(groupsData[index], groupsData[index].name);
        } else {
          // その他は通常のポップアップ
          const arr = groupsData[index][type] || [];
          const label = target.textContent.split(':')[0];
          showList(label, arr);
        }
      });
    }

  } catch (e) {
    const msg = e.message || String(e);
    status.className = 'error';
    status.textContent = `Error loading data: ${msg}`;
    console.error(e);
  }
}

document.getElementById('refresh').addEventListener('click', () => loadGroups());
document.getElementById('showNames').addEventListener('change', () => loadGroups());
document.getElementById('sortBy').addEventListener('change', () => loadGroups());

// 初回ロード
loadGroups();