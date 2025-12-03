// 棒グラフを描画する関数
function drawBarChart(container, values, colors, maxValue) {
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
    // スタックバーの場合（Pチャートの合計幅内で各スタックを分割）
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
        if (barWidthPercent >= 8) {
          bar.textContent = value;
        }
        barContainer.appendChild(bar);
        currentX += barWidthPercent;
      }
    });
    let total = values.reduce((sum, val) => sum + val, 0);
    const barWidthPercent = total / maxValue * 100;
    totalBarWidthPercent = barWidthPercent;
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

function showList(title, arr) {
  const popup = document.getElementById('popup');
  const overlay = document.getElementById('popupOverlay');
  const titleEl = document.getElementById('popupTitle');
  const content = document.getElementById('popupContent');
  const sortedArr = arr.length ? [...arr].sort() : [];
  titleEl.textContent = title;
  content.textContent = sortedArr.length ? sortedArr.join('\n') : '(no items)';
  popup.style.display = 'block';
  overlay.style.display = 'block';
}

async function showMembersPopup(groupData, groupName, initialFilter = 'members') {
  const popup = document.getElementById('membersPopup');
  const overlay = document.getElementById('membersPopupOverlay');
  const title = document.getElementById('membersPopupTitle');
  const membersListContent = document.getElementById('membersListContent');
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  
  title.textContent = groupName;
  
  // 各フィルターのカウントを計算
  const counts = {
    members: groupData.participantsList ? groupData.participantsList.length : 0,
    mp: groupData.usersList ? groupData.usersList.length : 0,
    invited: groupData.invited ? groupData.invited.length : 0,
    staffs: groupData.staffs ? groupData.staffs.length : 0,
    individuals: groupData.individuals ? groupData.individuals.length : 0,
    participants: 0
  };
  counts.participants = counts.mp + counts.invited + counts.staffs + counts.individuals;
  
  // 初期タイトル設定
  const affiliationsTitle = document.querySelector('#membersList h3');
  const participantsTitle = document.querySelector('#participantsList h3');
  affiliationsTitle.textContent = 'Affiliations';
  if (groupData.isException) {
    affiliationsTitle.classList.add('exception');
  }
  participantsTitle.textContent = 'Participants';
  
  // フィルター状態
  let currentFilter = initialFilter;
  
  // MPフィルターボタンを追加
  const filterBar = document.getElementById('participationsFilter');
  if (filterBar) {
    const buttonContainer = document.getElementById('participationsButtonContainer');
    if (buttonContainer) {
      buttonContainer.innerHTML = ''; // 既存のボタンをクリア
      const filters = ['members', 'mp', 'invited', 'staffs', 'individuals', 'participants'];
      const filterLabels = {
        'members': 'Members',
        'mp': 'Member Participants',
        'invited': 'Invited Experts',
        'staffs': 'Staffs',
        'individuals': 'Individuals',
        'participants': 'Participants'
      };
      filters.forEach(filter => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        if (groupData.isException && (filter === 'members' || filter === 'mp' || filter === 'invited' || filter === 'individuals')) {
          btn.classList.add('exception');
        }
        btn.setAttribute('data-filter', filter);
        btn.textContent = `${filterLabels[filter]}: ${counts[filter]}`;
        buttonContainer.appendChild(btn);
      });
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
      const div = document.createElement('div');
      div.className = 'member-item selected';
      if (groupData.isException) {
        div.classList.add('exception');
      }
      div.textContent = 'All Members';
      membersListContent.appendChild(div);
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
      const div = document.createElement('div');
      div.className = 'member-item selected';
      if (groupData.isException) {
        div.classList.add('exception');
      }
      div.textContent = 'All Members+IE+S+Ind';
      membersListContent.appendChild(div);
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
        if (groupData.isException) {
          div.classList.add('exception');
        }
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
        if (groupData.isException) {
          div.classList.add('exception');
        }
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
  overlay.style.display = 'block';
}

async function showParticipantsForMember(groupData, memberOrg) {
  const participantsListContent = document.getElementById('participantsListContent');
  const userDetailsContent = document.getElementById('userDetailsContent');
  
  participantsListContent.innerHTML = '';
  userDetailsContent.innerHTML = '<p style="padding: 12px; color: #666;">Select a participant to view details</p>';
  
  // membersMapから該当する組織のparticipantsを取得
  const membersMap = groupData.membersMap || {};
  
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
      dl.style.padding = '0 12px 12px 12px';
      dl.innerHTML = `<dt>Name</dt><dd>${escapeHtml(userName || 'Unknown')}</dd>`;
      dl.innerHTML += `<dt>User URL</dt><dd><a href="${escapeHtml(userHref)}" target="_blank">${escapeHtml(userHref)}</a></dd>`;
      dl.innerHTML += `<p style="margin-top: 12px; color: #999; font-size: 0.9em;">Detailed user information not available (member organization participant)</p>`;
      userDetailsContent.innerHTML = '';
      userDetailsContent.appendChild(dl);
      return;
    }
    
    const user = userData.data;
    const dl = document.createElement('dl');
    dl.style.padding = '0 12px 12px 12px';
    
    if (user.name) {
      dl.innerHTML += `<dt>Name:</dt><dd>${escapeHtml(user.name)}</dd>`;
    }
    if (user.given) {
      dl.innerHTML += `<dt>Given Name:</dt><dd>${escapeHtml(user.given)}</dd>`;
    }
    if (user.family) {
      dl.innerHTML += `<dt>Family Name:</dt><dd>${escapeHtml(user.family)}</dd>`;
    }
    if (user['connected-accounts'] && user['connected-accounts'].length > 0) {
      dl.innerHTML += `<dt>Connected Accounts:</dt>`;
      user['connected-accounts'].forEach(account => {
        dl.innerHTML += `<dd>${escapeHtml(account.service || 'Unknown')}: ${escapeHtml(account.name || account.id || 'N/A')}</dd>`;
      });
    }
    if (user.description) {
      dl.innerHTML += `<dt>Description:</dt><dd>${escapeHtml(user.description)}</dd>`;
    }
    
    userDetailsContent.innerHTML = '';
    userDetailsContent.appendChild(dl);
    
  } catch (e) {
    userDetailsContent.innerHTML = `<p style="padding: 12px; color: #900;">Error: ${e.message}</p>`;
  }
}

document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
});

document.getElementById('popupOverlay').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('popupOverlay').style.display = 'none';
});

document.getElementById('membersPopupClose').addEventListener('click', () => {
  document.getElementById('membersPopup').style.display = 'none';
  document.getElementById('membersPopupOverlay').style.display = 'none';
});

document.getElementById('membersPopupOverlay').addEventListener('click', () => {
  document.getElementById('membersPopup').style.display = 'none';
  document.getElementById('membersPopupOverlay').style.display = 'none';
});

// ESCキーでポップアップを閉じる
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popup = document.getElementById('popup');
    const popupOverlay = document.getElementById('popupOverlay');
    const membersPopup = document.getElementById('membersPopup');
    const membersPopupOverlay = document.getElementById('membersPopupOverlay');
    
    if (popup.style.display === 'block') {
      popup.style.display = 'none';
      popupOverlay.style.display = 'none';
    }
    if (membersPopup.style.display === 'flex') {
      membersPopup.style.display = 'none';
      membersPopupOverlay.style.display = 'none';
    }
  }
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

    // 各タイプのグループ数を計算
    const counts = {
      wg: 0,
      ig: 0,
      cg: 0,
      tf: 0,
      other: 0,
      all: groupsData.length
    };
    groupsData.forEach(g => {
      const type = g.groupType;
      if (counts.hasOwnProperty(type)) {
        counts[type]++;
      } else {
        counts.other++;
      }
    });

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
    const allInvitedExperts = new Map();
    const allStaffs = new Map();
    const allIndividuals = new Map();
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
          allInvitedExperts.set(ie.name, ie);
          allParticipants.add(ie);
        });
      }
      // Staffs
      if (group.staffs) {
        group.staffs.forEach(staff => {
          allStaffs.set(staff.name, staff);
          allParticipants.add(staff);
        });
      }
      // Individuals
      if (group.individuals) {
        group.individuals.forEach(ind => {
          allIndividuals.set(ind.name, ind);
          allParticipants.add(ind);
        });
      }
    });

    status.className = '';
    status.textContent = '';
    
    // Summary情報を表示
    const lastChecked = groupsData._metadata?.lastChecked;
    let dateStr = '';
    if (lastChecked) {
      const date = new Date(lastChecked);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames[date.getUTCMonth()];
      const day = date.getUTCDate();
      const year = date.getUTCFullYear();
      dateStr = `as of ${month} ${day}, ${year}`;
    }
    summary.innerHTML = `
      <section style="border: 1px solid #ddd; border-radius: 4px; padding: 12px; background: #f8f9fa; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Summary</div>
          <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 1em;">
            <span>Groups: ${groupsData.length}</span>
            <span>Members (M): <span class="clickable" data-summary-type="members">${allMembers.size}</span></span>
            <span>Member Participants (MP): <span class="clickable" data-summary-type="users">${allUsers.size}</span></span>
            <span>Invited Experts (IE): <span class="clickable" data-summary-type="invited">${allInvitedExperts.size}</span></span>
            <span>Staffs (S): <span class="clickable" data-summary-type="staffs">${allStaffs.size}</span></span>
            <span>Individuals (Ind): <span class="clickable" data-summary-type="individuals">${allIndividuals.size}</span></span>
            <span>Participants (P): <span class="clickable" data-summary-type="participants">${allParticipants.size}</span></span>
            <span style="font-size: 1em; color: #666;">Note: P=MP+IE+S+Ind</span>
          </div>
        </div>
        <div style="font-size: 0.9em; color: #666; white-space: nowrap;">${dateStr}</div>
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
      { key: 'users', label: 'MP', sortable: true },
      { key: 'invited', label: 'IE', sortable: true },
      { key: 'staffs', label: 'S', sortable: true },
      { key: 'individuals', label: 'Ind', sortable: true },
      { key: 'participants', label: 'P', sortable: true },
      { key: 'charts', label: 'Charts', sortable: false }
    ];
    
    // フィルター行を別要素として作成
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    filterBar.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; background: #f6f8fa; border-bottom: 1px solid #ddd;">
        <div style="font-size: 1em; font-weight: 600;">Groups</div>
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
      const filterTypeLabels = {
        'wg': 'Working Groups',
        'ig': 'Interest Groups',
        'cg': 'Community Groups',
        'tf': 'Task Forces',
        'other': 'Other Groups',
        'all': 'All Groups'
      };
      const groupTypeFilter = document.getElementById('groupTypeFilter');
      if (groupTypeFilter) {
        const currentFilterType = localStorage.getItem('groupTypeFilter') || 'wg';
        groupTypeFilter.querySelectorAll('.filter-btn').forEach(btn => {
          const type = btn.dataset.type;
          const label = filterTypeLabels[type] || type.toUpperCase();
          btn.textContent = `${label}: ${counts[type]}`;
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
      membersCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="participantsList">${g.membersCount || 0}</span>`;
      row.appendChild(membersCell);
      
      // Users
      const usersCell = document.createElement('td');
      usersCell.style.width = '50px';
      usersCell.style.minWidth = '50px';
      usersCell.style.maxWidth = '50px';
      usersCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="usersList">${g.usersCount || 0}</span>`;
      row.appendChild(usersCell);
      
      // Invited Experts
      const invitedCell = document.createElement('td');
      invitedCell.style.width = '50px';
      invitedCell.style.minWidth = '50px';
      invitedCell.style.maxWidth = '50px';
      invitedCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="invited">${g.invitedCount || 0}</span>`;
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
      individualsCell.innerHTML = `<span class="clickable ${g.isException ? 'exception' : ''}" data-index="${originalIndex}" data-type="individuals">${g.individualsCount || 0}</span>`;
      row.appendChild(individualsCell);
      
      // Participants (Users + Invited Experts)
      const participantsCell = document.createElement('td');
      participantsCell.style.width = '50px';
      participantsCell.style.minWidth = '50px';
      participantsCell.style.maxWidth = '50px';
      participantsCell.innerHTML = `<span class="clickable" data-index="${originalIndex}" data-type="totalParticipantsList">${g.totalParticipantsCount || 0}</span>`;
      row.appendChild(participantsCell);
      
      // Charts Cell (上下配置)
      const chartsCell = document.createElement('td');
      chartsCell.style.width = '250px';
      chartsCell.style.minWidth = '250px';
      chartsCell.style.maxWidth = '250px';
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
    groupsDiv.appendChild(bodyContainer);
    
    // チャートを描画
    const maxMembers = Math.max(...sortedResults.map(g => g.membersCount || 0));
    const maxParticipants = Math.max(...sortedResults.map(g => g.totalParticipantsCount || 0));
    // 両方のチャートで同じスケールを使用
    const maxScale = Math.max(maxMembers, maxParticipants);
    
    for (let i = 0; i < sortedResults.length; i++) {
      const g = sortedResults[i];
      
      // Members Chart
      const membersDiv = document.getElementById(`members-chart-${i}`);
      if (membersDiv) {
        drawBarChart(membersDiv, [g.membersCount || 0], ['#0969da'], maxScale);
      }

      // Participants Chart (Stacked: MP, IE, S, Ind, ソート順に応じて並び替え)
      const participantsDiv = document.getElementById(`participants-chart-${i}`);
      if (participantsDiv) {
        // デフォルト順
        let stackOrder = [
          { key: 'users', value: g.usersCount || 0, color: '#1f883d' },
          { key: 'invited', value: g.invitedCount || 0, color: '#bf8700' },
          { key: 'staffs', value: g.staffsCount || 0, color: '#cf222e' },
          { key: 'individuals', value: g.individualsCount || 0, color: '#8250df' }
        ];
        // 現在のsortByに応じて先頭に持ってくる
        const sortBy = document.getElementById('sortBy').value;
        const idx = stackOrder.findIndex(s => s.key === sortBy);
        if (idx > 0) {
          // 先頭に移動
          const [item] = stackOrder.splice(idx, 1);
          stackOrder.unshift(item);
        }
        drawBarChart(
          participantsDiv,
          stackOrder.map(s => s.value),
          stackOrder.map(s => s.color),
          maxScale
        );
      }
    }

    if (!attachedHandler) {
      attachedHandler = true;
      
      function showSummaryPopup(type) {
        let groupData = {};
        let groupName = 'Summary';
        let initialFilter = type;
        
        switch(type) {
          case 'members':
            groupData.participantsList = Array.from(allMembers);
            groupData.membersMap = {};
            groupsData.forEach(g => {
              if (g.membersMap) {
                Object.assign(groupData.membersMap, g.membersMap);
              }
            });
            break;
          case 'participants':
            groupData.membersMap = {};
            groupData.invited = Array.from(allInvitedExperts.values());
            groupData.staffs = Array.from(allStaffs.values());
            groupData.individuals = Array.from(allIndividuals.values());
            groupData.usersList = Array.from(allUsers);
            break;
          case 'users': // MP
            groupData.membersMap = {};
            groupsData.forEach(g => {
              if (g.membersMap) {
                Object.keys(g.membersMap).forEach(org => {
                  if (!groupData.membersMap[org]) {
                    groupData.membersMap[org] = [];
                  }
                  groupData.membersMap[org].push(...g.membersMap[org]);
                });
              }
            });
            break;
          case 'invited':
            groupData.invited = Array.from(allInvitedExperts.values());
            break;
          case 'staffs':
            groupData.staffs = Array.from(allStaffs.values());
            break;
          case 'individuals':
            groupData.individuals = Array.from(allIndividuals.values());
            break;
        }
        
        showMembersPopup(groupData, groupName, initialFilter);
      }
      
      // Summaryのクリックイベント
      summary.addEventListener('click', ev => {
        const target = ev.target.closest('.clickable');
        if (!target) return;
        const summaryType = target.getAttribute('data-summary-type');
        if (summaryType) {
          showSummaryPopup(summaryType);
        }
      });
      
      groupsDiv.addEventListener('click', ev => {
        const target = ev.target.closest('.clickable');
        if (!target) return;
        const summaryType = target.getAttribute('data-summary-type');
        if (summaryType) {
          showSummaryPopup(summaryType);
          return;
        }
        const index = parseInt(target.getAttribute('data-index'));
        const type = target.getAttribute('data-type');
        if (isNaN(index) || !groupsData[index]) return;
        
        // Membersの場合は特別な3ペインポップアップを表示
        let initialFilter = 'members';
        if (type === 'participantsList') {
          initialFilter = 'members';
        } else if (type === 'totalParticipantsList') {
          initialFilter = 'participants';
        } else if (type === 'usersList') {
          initialFilter = 'mp';
        } else if (type === 'invited') {
          initialFilter = 'invited';
        } else if (type === 'staffs') {
          initialFilter = 'staffs';
        } else if (type === 'individuals') {
          initialFilter = 'individuals';
        }
        showMembersPopup(groupsData[index], groupsData[index].name, initialFilter);
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