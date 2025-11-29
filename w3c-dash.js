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
  const content = document.getElementById('popupContent');
  content.textContent = title + '\n\n' + (arr.length ? arr.join('\n') : '(no items)');
  popup.style.display = 'block';
}

document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
});

let attachedHandler = false;
let groupsData = []; // グループデータを保存

async function loadGroups() {
  const status = document.getElementById('status');
  const groupsDiv = document.getElementById('groups');
  const summary = document.getElementById('summary');
  
  groupsDiv.innerHTML = '';
  status.className = 'loading';
  status.textContent = 'Loading group data from w3c_api.json...';

  try {
    const results = await getAllGroupsInfo();
    groupsData = results; // データを保存

    status.className = '';
    status.textContent = `Loaded ${results.length} groups.`;
    summary.textContent = `Showing ${results.length} groups — sorted by invited-expert count (largest first). Click counts to see names.`;

    groupsDiv.innerHTML = '';
    for (let i = 0; i < results.length; i++) {
      const g = results[i];
      const el = document.createElement('div');
      el.className = 'group';
      const pButton = `<span class="clickable" data-index="${i}" data-type="participantsList">Participations: <strong>${g.participantsCount || 0}</strong></span>`;
      const uButton = `<span class="clickable" data-index="${i}" data-type="usersList">Users: <strong>${g.usersCount || 0}</strong></span>`;
      const iButton = `<span class="clickable" data-index="${i}" data-type="invited">Invited Experts: <strong>${g.invitedCount || 0}</strong></span>`;
      el.innerHTML = `<div><strong>${escapeHtml(g.name)}</strong></div><div class="small">${pButton} &nbsp; ${uButton} &nbsp; ${iButton} ${g._error ? ('<div class="error">(error: ' + escapeHtml(g._error) + ')</div>') : ''}</div>`;
      groupsDiv.appendChild(el);
    }

    if (!attachedHandler) {
      attachedHandler = true;
      groupsDiv.addEventListener('click', ev => {
        const target = ev.target.closest('.clickable');
        if (!target) return;
        const index = parseInt(target.getAttribute('data-index'));
        const type = target.getAttribute('data-type');
        if (isNaN(index) || !groupsData[index]) return;
        
        const arr = groupsData[index][type] || [];
        const label = target.textContent.split(':')[0];
        showList(label, arr);
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

// 初回ロード
loadGroups();