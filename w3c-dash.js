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
  
  // 初期タイトル設定
  const affiliationsTitle = document.querySelector('#membersList h3');
  const participantsTitle = document.querySelector('#participantsList h3');
  affiliationsTitle.textContent = 'Affiliations';
  participantsTitle.textContent = 'Participants';
  
  // フィルター状態
  let currentFilter = 'members';
  
  // MPフィルターボタンを追加
  const filterBar = document.getElementById('participationsFilter');
  if (filterBar && !filterBar.querySelector('[data-filter="mp"]')) {
    const pBtn = filterBar.querySelector('[data-filter="participants"]');
    const mpBtn = document.createElement('button');
    mpBtn.className = 'filter-btn';
    mpBtn.setAttribute('data-filter', 'mp');
    mpBtn.textContent = 'MP';
    if (pBtn) {
      const buttonContainer = pBtn.parentNode;
      buttonContainer.insertBefore(mpBtn, pBtn.nextSibling);
    } else {
      // Fallback, but P button should exist
      const buttonContainer = filterBar.querySelector('.filter-btn')?.parentNode || filterBar;
      buttonContainer.appendChild(mpBtn);
    }
  }
  
  // リストをフィルターして表示する関数
  async function renderFilteredList() {
    membersListContent.innerHTML = '';
    // Affiliationsペインの幅を固定
    membersListContent.style.minWidth = '200px';
    
    const affiliationsTitle = document.querySelector('#membersList h3');
    const participantsTitle = document.querySelector('#participantsList h3');
    
    // フィルターボタンのアクティブ状態を更新
    const filterButtons = document.querySelectorAll('#participationsFilter .filter-btn');
    filterButtons.forEach(b => b.classList.remove('active'));
    const activeButton = document.querySelector(`#participationsFilter .filter-btn[data-filter="${currentFilter}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }
    
    if (currentFilter === 'mp') {
      // MPが選択された場合：Affiliationsペインに"All Members"を表示し、Participantsペインに全ユーザー（member organizationの参加者）を表示
      membersListContent.innerHTML = '<div class="member-item selected">All Members</div>';
      participantsListContent.innerHTML = '';
      userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
      
      // groupData.membersMap から全ユーザーを集計
      const allMPs = [];
      if (groupData.membersMap) {
        Object.values(groupData.membersMap).forEach(memberParticipants => {
          if (memberParticipants) {
            memberParticipants.forEach(participant => {
              allMPs.push({ name: participant.name, type: 'user', userHref: participant.userHref });
            });
          }
        });
      }
      // 名前でソート
      const sortedMPs = allMPs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      sortedMPs.forEach(participant => {
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
      
      // タイトル更新
      affiliationsTitle.textContent = `Affiliations: 1`;
      participantsTitle.textContent = `Participants: ${sortedMPs.length}`;
      
      return;
    }
    
    if (currentFilter === 'participants') {
      // Pが選択された場合：Participationsペインに"M+IE+Staff+Indv"を表示し、Participantsペインにすべてを表示
      membersListContent.innerHTML = '<div class="member-item selected">M+IE+Staff+Indv</div>';
      participantsListContent.innerHTML = '';
      userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
      
      // すべての参加者を集める（個人ユーザーのみ）
      const allParticipants = [];
      
      // Users (membersMapから取得した個人ユーザー)
      if (groupData.membersMap) {
        Object.values(groupData.membersMap).forEach(memberParticipants => {
          if (memberParticipants) {
            memberParticipants.forEach(participant => {
              allParticipants.push({ name: participant.name, type: 'user', userHref: participant.userHref });
            });
          }
        });
      }
      
      // Invited Experts
      if (groupData.invited) {
        groupData.invited.forEach(ie => {
          allParticipants.push({ name: ie.name, type: 'invited', userHref: ie.userHref });
        });
      }
      
      // Staffs
      if (groupData.staffs) {
        groupData.staffs.forEach(staff => {
          allParticipants.push({ name: staff.name, type: 'staff', userHref: staff.userHref });
        });
      }
      
      // Individuals
      if (groupData.individuals) {
        groupData.individuals.forEach(ind => {
          allParticipants.push({ name: ind.name, type: 'individual', userHref: ind.userHref });
        });
      }
      
      // 名前でソート
      const sortedAllParticipants = allParticipants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      sortedAllParticipants.forEach(participant => {
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
      
      // タイトル更新
      affiliationsTitle.textContent = `Affiliations: 1`;
      participantsTitle.textContent = `Participants: ${sortedAllParticipants.length}`;
      
      return;
    }
    
    // Members (participantsList)
    if (currentFilter === 'all' || currentFilter === 'members') {
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
      
      // タイトル更新（Membersの場合）
      affiliationsTitle.textContent = `Affiliations: ${sortedMembers.length}`;
    }
    
    // Special types
    const specialTypes = [
      { key: 'invited', label: 'Invited Experts' },
      { key: 'staffs', label: 'Staffs' },
      { key: 'individuals', label: 'Individuals' }
    ];
    
    specialTypes.forEach(type => {
      if (currentFilter === 'all' || currentFilter === type.key) {
        const div = document.createElement('div');
        div.className = 'member-item special-affiliation';
        div.textContent = type.label;
        div.dataset.afftype = type.key;
        div.addEventListener('click', async () => {
          document.querySelectorAll('.member-item').forEach(el => el.classList.remove('selected'));
          div.classList.add('selected');
          const participantsListContent = document.getElementById('participantsListContent');
          const userDetailsContent = document.getElementById('userDetailsContent');
          participantsListContent.innerHTML = '';
          userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
          let list = [];
          let emptyMsg = '';
          if (type.key === 'invited') {
            list = groupData.invited || [];
            emptyMsg = 'No Invited Experts available';
          } else if (type.key === 'staffs') {
            list = groupData.staffs || [];
            emptyMsg = 'No Staffs available';
          } else if (type.key === 'individuals') {
            list = groupData.individuals || [];
            emptyMsg = 'No Individuals available';
          }
          if (list.length === 0) {
            participantsListContent.innerHTML = `<p style="padding: 12px; color: #666; font-style: italic;">${emptyMsg}</p>`;
            // タイトル更新（特殊タイプの場合）
            participantsTitle.textContent = `Participants: 0`;
          } else {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(item => {
              const pDiv = document.createElement('div');
              pDiv.className = 'participant-item';
              pDiv.textContent = item.name;
              pDiv.addEventListener('click', async () => {
                document.querySelectorAll('.participant-item').forEach(el => el.classList.remove('selected'));
                pDiv.classList.add('selected');
                await showUserDetails(item.userHref, item.name);
              });
              participantsListContent.appendChild(pDiv);
            });
            // タイトル更新（特殊タイプの場合）
            participantsTitle.textContent = `Participants: ${list.length}`;
          }
        });
        membersListContent.appendChild(div);
        
        // タイトル更新（特殊タイプの場合、Affiliationsは1）
        affiliationsTitle.textContent = `Affiliations: 1`;
      }
    });
    
    // デフォルトで最初の項目を選択
    const firstItem = membersListContent.querySelector('.member-item');
    if (firstItem) {
      firstItem.classList.add('selected');
      if (firstItem.dataset.member) {
        await showParticipantsForMember(groupData, firstItem.dataset.member);
      } else if (firstItem.dataset.afftype) {
        // Special typeの場合、クリックイベントをトリガー
        firstItem.click();
      }
    } else {
      participantsListContent.innerHTML = '<p style="padding: 12px; color: #666; font-style: italic;">No items available</p>';
      userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
    }
  }
  
  // フィルターボタンのイベントリスナー
  const filterButtons = document.querySelectorAll('#participationsFilter .filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // アクティブクラスを更新
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      currentFilter = btn.dataset.filter;
      renderFilteredList();
    });
  });
  
  // 初期リストを表示
  await renderFilteredList();
  
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
    // タイトル更新
    const participantsTitle = document.querySelector('#participantsList h3');
    participantsTitle.textContent = `Participants: 0`;
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
  
  // タイトル更新
  const participantsTitle = document.querySelector('#participantsList h3');
  participantsTitle.textContent = `Participants: ${sortedParticipants.length}`;
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
let groupsData = null; // 初回のみロード
let groupsInfoLoaded = false;

async function renderData() {
  const status = document.getElementById('status');
  const groupsDiv = document.getElementById('groups');
  const summary = document.getElementById('summary');
  const legendDiv = document.getElementById('legend');

  groupsDiv.innerHTML = '';
  status.className = 'loading';
  status.textContent = 'Loading W3C API data...';

  try {
    // 初回のみロード
    if (!groupsInfoLoaded) {
      const results = await getAllGroupsInfo();
      groupsData = results;
      groupsInfoLoaded = true;
    }

    // フィルター・ソートはgroupsDataのみ参照
    const filterType = localStorage.getItem('groupTypeFilter') || 'wg';
    const filteredResults = filterType === 'all'
      ? groupsData
      : groupsData.filter(g => g.groupType === filterType);

    // ソート基準を取得
    const sortBy = document.getElementById('sortBy').value;
    let sortedResults;

    switch(sortBy) {
      case 'name':
        sortedResults = [...filteredResults].sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
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
      case 'staffs':
        sortedResults = [...filteredResults].sort((a, b) => (b.staffsCount || 0) - (a.staffsCount || 0));
        break;
      case 'individuals':
        sortedResults = [...filteredResults].sort((a, b) => (b.individualsCount || 0) - (a.individualsCount || 0));
        break;
      case 'invited':
      default:
        sortedResults = [...filteredResults].sort((a, b) => (b.invitedCount || 0) - (a.invitedCount || 0));
        break;
    }

    // 全体統計を計算（重複を除く）
    const allMembers = new Set();
    const allUsers = new Set();
    const allInvitedExperts = new Set();
    const allStaffs = new Set();
    const allIndividuals = new Set();
    const allParticipants = new Set();

    groupsData.forEach(group => {
      // Members
      if (group.participantsList) {
        group.participantsList.forEach(member => allMembers.add(member));
      }
      // Users
      if (group.usersList) {
        group.usersList.forEach(user => {
          allUsers.add(user);
          allParticipants.add(user);
        });
      }
      // Invited Experts
      if (group.invited) {
        group.invited.forEach(ie => {
          allInvitedExperts.add(ie);
          allParticipants.add(ie);
        });
      }
      // Staffs
      if (group.staffs) {
        group.staffs.forEach(staff => {
          allStaffs.add(staff);
          allParticipants.add(staff);
        });
      }
      // Individuals
      if (group.individuals) {
        group.individuals.forEach(ind => {
          allIndividuals.add(ind);
          allParticipants.add(ind);
        });
      }
    });

    status.className = '';
    status.textContent = '';
    
    // Summary情報を表示
    summary.innerHTML = `
      <section style="border: 1px solid #ddd; border-radius: 4px; padding: 12px; background: #f8f9fa; margin-bottom: 12px;">
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Summary</div>
        <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 0.95em;">
          <span>Groups: ${groupsData.length}</span>
          <span>Members (M): ${allMembers.size}</span>
          <span>Participants (P): ${allParticipants.size}</span>
          <span>Member Participants (MP): ${allUsers.size}</span>
          <span>Invited Experts (IE): ${allInvitedExperts.size}</span>
          <span>Staffs (S): ${allStaffs.size}</span>
          <span>Individuals (Ind): ${allIndividuals.size}</span>
        </div>
      </section>
    `;

    groupsDiv.innerHTML = '';
    
    // ヘッダーコンテナを作成
    const headerContainer = document.createElement('div');
    headerContainer.className = 'table-header-container';
    
    // テーブル（ヘッダー用）を作成
    const headerTable = document.createElement('table');
    headerTable.className = 'groups-table groups-table-header';
    
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
      { key: 'participants', label: 'P', sortable: true },
      { key: 'users', label: 'MP', sortable: true },
      { key: 'invited', label: 'IE', sortable: true },
      { key: 'staffs', label: 'S', sortable: true },
      { key: 'individuals', label: 'Ind', sortable: true },
      { key: 'charts', label: 'Charts', sortable: false }
    ];
    
    // フィルター行を別要素として作成
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    filterBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #f6f8fa; border-bottom: 1px solid #ddd;">
        <span style="font-size: 18px; font-weight: 600;">Groups</span>
        <span style="font-size: 14px; color: #57606a; margin-left: 8px;">Type:</span>
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
    headerContainer.appendChild(filterBar);
    
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
        th.style.width = '250px';
        th.style.minWidth = '250px';
        th.style.maxWidth = '250px';
      }
      
      if (col.key === 'name') {
        // Group Name列のヘッダー
        th.style.cursor = 'pointer';
        th.className = sortBy === 'name' ? 'sorted' : '';
        th.onclick = () => {
          document.getElementById('sortBy').value = 'name';
          renderData();
        };
        th.innerHTML = `${col.label}<span class="sort-icon">↓</span>`;
      } else if (col.sortable) {
        th.style.cursor = 'pointer';
        th.className = sortBy === col.key ? 'sorted' : '';
        th.onclick = () => {
          document.getElementById('sortBy').value = col.key;
          renderData();
        };
        th.innerHTML = `${col.label}<span class="sort-icon">↓</span>`;
      } else if (col.key === 'charts') {
        // ChartsカラムにLegendを統合
        th.innerHTML = `
          <div style="font-size: 0.75em; line-height: 1.3;">
            <div style="font-weight: bold; margin-bottom: 4px;">Charts</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center;">
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; background-color: #0969da;"></div>
                <span>M</span>
              </div>
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; background-color: #1f883d;"></div>
                <span>MP</span>
              </div>
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; background-color: #bf8700;"></div>
                <span>IE</span>
              </div>
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; background-color: #cf222e;"></div>
                <span>S</span>
              </div>
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; background-color: #8250df;"></div>
                <span>Ind</span>
              </div>
              <div style="display: flex; align-items: center; gap: 3px;">
                <div style="width: 10px; height: 10px; border: 1px solid #000;"></div>
                <span>P = MP+IE+S+Ind</span>
              </div>
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
    
    // ボディコンテナを作成
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'table-body-container';
    
    // テーブル（ボディ用）を作成
    const bodyTable = document.createElement('table');
    bodyTable.className = 'groups-table groups-table-body';
    
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
            renderData();
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
      const originalIndex = groupsData.indexOf(g);
      
      // グループ名
      const nameCell = document.createElement('td');
      nameCell.className = 'group-name';
      nameCell.textContent = g.name;
      row.appendChild(nameCell);
      
      // Members
      const membersCell = document.createElement('td');
      membersCell.style.width = '50px';
      membersCell.style.minWidth = '50px';
      membersCell.style.maxWidth = '50px';
      membersCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="participantsList">${g.membersCount || 0}</span>`;
      row.appendChild(membersCell);
      
      // Participants (Users + Invited Experts)
      const participantsCell = document.createElement('td');
      participantsCell.style.width = '50px';
      participantsCell.style.minWidth = '50px';
      participantsCell.style.maxWidth = '50px';
      participantsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="totalParticipantsList">${g.totalParticipantsCount || 0}</span>`;
      row.appendChild(participantsCell);
      
      // Users
      const usersCell = document.createElement('td');
      usersCell.style.width = '50px';
      usersCell.style.minWidth = '50px';
      usersCell.style.maxWidth = '50px';
      usersCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="usersList">${g.usersCount || 0}</span>`;
      row.appendChild(usersCell);
      
      // Invited Experts
      const invitedCell = document.createElement('td');
      invitedCell.style.width = '50px';
      invitedCell.style.minWidth = '50px';
      invitedCell.style.maxWidth = '50px';
      invitedCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="invited">${g.invitedCount || 0}</span>`;
      if (g._error) {
        invitedCell.innerHTML += '<div class="error">(err)</div>';
      }
      row.appendChild(invitedCell);
      
      // Staffs
      const staffsCell = document.createElement('td');
      staffsCell.style.width = '50px';
      staffsCell.style.minWidth = '50px';
      staffsCell.style.maxWidth = '50px';
      staffsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="staffs">${g.staffsCount || 0}</span>`;
      row.appendChild(staffsCell);
      
      // Individuals
      const individualsCell = document.createElement('td');
      individualsCell.style.width = '50px';
      individualsCell.style.minWidth = '50px';
      individualsCell.style.maxWidth = '50px';
      individualsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="individuals">${g.individualsCount || 0}</span>`;
      row.appendChild(individualsCell);
      
      // Charts Cell (上下配置)
      const chartsCell = document.createElement('td');
      chartsCell.style.width = '250px';
      chartsCell.style.minWidth = '250px';
      chartsCell.style.maxWidth = '250px';
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
    
    bodyTable.appendChild(tbody);
    bodyContainer.appendChild(bodyTable);
    groupsDiv.appendChild(bodyContainer);
    
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
              tooltip: {
                enabled: true,
                callbacks: {
                  title: () => '',
                  label: function(context) {
                      // 1行表示（M:10）
                      return `M: ${context.parsed.x}`;
                  }
                }
              },
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
                label: 'Member Participants',
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
                label: 'Staffs',
                data: [g.staffsCount || 0],
                backgroundColor: '#cf222e',
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
              tooltip: {
                enabled: true,
                callbacks: {
                  title: () => '',
                  label: function(context) {
                    // 各バーごとに"MP:10 P:20"など表示
                    let key = '';
                    switch (context.dataset.label) {
                      case 'Member Participants': key = 'MP'; break;
                      case 'Invited Experts': key = 'IE'; break;
                      case 'Staffs': key = 'S'; break;
                      case 'Individuals': key = 'Ind'; break;
                      default: key = context.dataset.label;
                    }
                    const total = context.chart.data.datasets.reduce((sum, ds) => sum + ds.data[0], 0);
                    return `${key}:${context.parsed.x} P:${total}`;
                  },
                  footer: () => ''
                }
              },
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

document.getElementById('sortBy').addEventListener('change', () => renderData());

// 初回ロード
renderData();