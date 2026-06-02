// Team Hierarchy Visualization Module
// Handles the Team tab UI with expandable org chart

(function() {
  'use strict';

  // Only initialize if team tab exists
  const teamTab = document.getElementById('tab-team');
  if (!teamTab) return;

  function teamFetch(url, options = {}) {
    const headers = options.headers || {};
    const apiKey = sessionStorage.getItem('dbxSignApiKey');
    if (apiKey) headers['x-api-key'] = apiKey;
    return fetch(url, { ...options, headers });
  }

  // Module state
  let teamData = null;
  let selectedTeamId = null;
  let selectedTeamName = null;
  const expandedTeams = new Set(); // Track which teams are expanded

  // DOM elements
  const refreshTeamBtn = document.getElementById('refreshTeamBtn');
  const collapseAllTeamsBtn = document.getElementById('collapseAllTeamsBtn');
  const teamLoading = document.getElementById('teamLoading');
  const teamError = document.getElementById('teamError');
  const teamChart = document.getElementById('teamChart');
  const teamMembersList = document.getElementById('teamMembersList');

  /**
   * Load team data from API
   */
  async function loadTeamData() {
    teamLoading.style.display = 'block';
    teamError.style.display = 'none';
    teamChart.innerHTML = '';
    teamMembersList.innerHTML = '';

    try {
      const res = await teamFetch('/api/team/debug');
      const data = await res.json();

      if (!res.ok) {
        // Check if it's a team API access error
        if (data.requiresTeamApi) {
          teamChart.innerHTML = `
            <div style="background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:20px;margin:20px 0;border-radius:8px;text-align:center;">
              <h3 style="margin:0 0 12px;color:#856404;">🔒 Team API Access Required</h3>
              <p style="margin:0 0 16px;line-height:1.6;">
                Your account is part of a team organization, but the Team API endpoints are not enabled for your account.
              </p>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#64748b;">
                The Team API is a premium feature that must be enabled by Dropbox Sign support. Contact your account manager or Dropbox Sign support to request access.
              </p>
              <p style="margin:0;font-size:13px;">
                <a href="https://support.hellosign.com" target="_blank" style="color:#2563eb;">Contact Dropbox Sign Support</a>
              </p>
            </div>
          `;
          return;
        }
        throw new Error(data.error || 'Failed to load team data');
      }

      // Check if user is not in a team
      if (data.not_in_team) {
        teamChart.innerHTML = `
          <div style="background:#dbeafe;border:1px solid #3b82f6;color:#1e3a8a;padding:20px;margin:20px 0;border-radius:8px;text-align:center;">
            <h3 style="margin:0 0 12px;color:#1e3a8a;">👤 Individual Account</h3>
            <p style="margin:0 0 16px;line-height:1.6;">
              Your account (<strong>${data.current_user.email}</strong>) is not part of a Dropbox Sign team organization.
            </p>
            <p style="margin:0;font-size:14px;color:#64748b;">
              Team features are only available for accounts that belong to a team organization. Contact your team admin to be added to a team.
            </p>
          </div>
        `;
        return;
      }

      teamData = data;
      renderTeamChart();
    } catch (err) {
      console.error('[TEAM] Error loading team data:', err);
      teamError.textContent = 'Failed to load team data: ' + err.message;
      teamError.style.display = 'block';
    } finally {
      teamLoading.style.display = 'none';
    }
  }

  /**
   * Render the org chart tree
   */
  function renderTeamChart() {
    if (!teamData || !teamData.current_team) {
      teamChart.innerHTML = '<p style="color:#64748b;">No team data available</p>';
      return;
    }

    console.log('[TEAM] Rendering chart with data:', teamData);
    console.log('[TEAM] Sub-teams count:', teamData.sub_teams?.length || 0);

    const chartContainer = document.createElement('div');
    chartContainer.className = 'team-chart';

    // Main team node
    const mainTeam = document.createElement('div');
    mainTeam.className = 'team-node';
    mainTeam.dataset.teamId = teamData.current_team.team_id;
    const memberCount = teamData.current_team.num_members;
    const memberText = memberCount === 1 ? t('team.member') : t('team.members');
    mainTeam.innerHTML = `
      <div class="team-node-name">${teamData.current_team.name}</div>
      <div class="team-node-count">${memberCount} ${memberText}</div>
    `;
    mainTeam.addEventListener('click', (e) => {
      console.log('[TEAM] Main team clicked, members:', teamData.team_members);
      selectTeam(e, teamData.current_team.team_id, teamData.team_members, teamData.current_team.name);
    });
    chartContainer.appendChild(mainTeam);

    // Connector line
    if (teamData.sub_teams && teamData.sub_teams.length > 0) {
      const connector = document.createElement('div');
      connector.className = 'team-connector';
      chartContainer.appendChild(connector);

      // Sub-teams container
      const subTeamsContainer = document.createElement('div');
      subTeamsContainer.className = 'sub-teams-container';

      teamData.sub_teams.forEach(subTeam => {
        // Create cluster (outer wrapper for isolation)
        const teamCluster = document.createElement('div');
        teamCluster.className = 'team-cluster';

        // Create wrapper node for team + its children
        const teamNodeWrapper = document.createElement('div');
        teamNodeWrapper.className = 'team-node-wrapper';
        teamNodeWrapper.dataset.teamId = subTeam.team_id;

        // The team card itself
        const subTeamCard = document.createElement('div');
        subTeamCard.className = 'team-node sub-team';
        subTeamCard.innerHTML = `
          <div class="team-node-name">
            <span class="expand-icon" style="display:none;">▶</span> ${subTeam.name}
          </div>
          <div class="team-node-count"><span class="member-count-loading">Loading...</span></div>
        `;

        // Pre-create empty children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children-container';

        // Load member count immediately
        loadMemberCount(subTeam.team_id, subTeamCard);

        // Check if this team has children to show/hide arrow
        checkForChildren(subTeam.team_id, subTeamCard);

        // Click handler: toggle expansion AND load members
        subTeamCard.addEventListener('click', async (e) => {
          e.stopPropagation();
          console.log('[TEAM] Sub-team clicked:', subTeam.name);

          // Toggle expansion
          toggleSubTeamExpansion(teamNodeWrapper, subTeamCard, childrenContainer, subTeam.team_id, subTeam.name);

          // Load members for this team
          await loadTeamMembers(subTeam.team_id, subTeam.name);

          // Update selection state
          updateTeamSelection(subTeamCard, subTeam.team_id, subTeam.name, childrenContainer);
        });

        teamNodeWrapper.appendChild(subTeamCard);
        teamNodeWrapper.appendChild(childrenContainer);
        teamCluster.appendChild(teamNodeWrapper);
        subTeamsContainer.appendChild(teamCluster);
      });

      chartContainer.appendChild(subTeamsContainer);
    }

    teamChart.appendChild(chartContainer);

    // Auto-select main team on first load
    if (!selectedTeamId) {
      mainTeam.click();
    }
  }

  /**
   * Select a team and show its members
   */
  function selectTeam(event, teamId, members, teamName) {
    console.log('[TEAM] selectTeam called:', { teamId, teamName, memberCount: members?.length });
    selectedTeamId = teamId;
    selectedTeamName = teamName;

    // Update selected state on nodes
    document.querySelectorAll('.team-node').forEach(node => {
      node.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');

    renderMembersList(members, teamName);
  }

  /**
   * Toggle expansion of a sub-team (cleaner approach with pre-created containers)
   */
  async function toggleSubTeamExpansion(wrapper, card, childrenContainer, teamId, teamName) {
    console.log('[TEAM] toggleSubTeamExpansion called:', { teamId, teamName });

    const isExpanded = wrapper.classList.contains('expanded');
    const icon = card.querySelector('.expand-icon');

    if (isExpanded) {
      // Collapse: just toggle CSS class
      console.log('[TEAM] Collapsing team:', teamName);
      wrapper.classList.remove('expanded');
      icon.textContent = '▶';
      return;
    }

    // Expand
    console.log('[TEAM] Expanding team:', teamName);

    // If children already loaded, just show them
    if (childrenContainer.hasChildNodes()) {
      console.log('[TEAM] Using cached children for:', teamName);
      icon.textContent = '▼';
      wrapper.classList.add('expanded');
      return;
    }

    // First time expanding - fetch and cache children
    try {
      const res = await teamFetch(`/api/team/${teamId}/sub_teams`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load sub-teams');
      }

      const subTeams = data.sub_teams || [];
      console.log('[TEAM] Loaded', subTeams.length, 'sub-teams for', teamName);

      if (subTeams.length === 0) {
        // No children - keep icon hidden and don't expand
        icon.style.display = 'none';
        return;
      }

      // Has children - show the icon and expand
      icon.style.display = 'inline';
      icon.textContent = '▼';
      wrapper.classList.add('expanded');

      // Render children (only once, then cached)
      subTeams.forEach(subTeam => {
        // Create wrapper for this child
        const childWrapper = document.createElement('div');
        childWrapper.className = 'team-node-wrapper';
        childWrapper.dataset.teamId = subTeam.team_id;

        // The child card
        const childCard = document.createElement('div');
        childCard.className = 'team-node sub-team';
        childCard.innerHTML = `
          <div class="team-node-name">
            <span class="expand-icon" style="display:none;">▶</span> ${subTeam.name}
          </div>
          <div class="team-node-count"><span class="member-count-loading">Loading...</span></div>
        `;

        // Load member count immediately
        loadMemberCount(subTeam.team_id, childCard);

        // Check if this team has children to show/hide arrow
        checkForChildren(subTeam.team_id, childCard);

        // Pre-create children container for this child
        const grandchildrenContainer = document.createElement('div');
        grandchildrenContainer.className = 'children-container';

        // Recursive toggle with member loading and selection
        childCard.addEventListener('click', async (e) => {
          e.stopPropagation();
          toggleSubTeamExpansion(childWrapper, childCard, grandchildrenContainer, subTeam.team_id, subTeam.name);
          await loadTeamMembers(subTeam.team_id, subTeam.name);
          updateTeamSelection(childCard, subTeam.team_id, subTeam.name, grandchildrenContainer);
        });

        childWrapper.appendChild(childCard);
        childWrapper.appendChild(grandchildrenContainer);
        childrenContainer.appendChild(childWrapper);
      });

    } catch (err) {
      console.error('[TEAM] Error fetching sub-teams:', err);
      icon.textContent = '▶';
      wrapper.classList.remove('expanded');
      alert('Failed to load sub-teams: ' + err.message);
    }
  }

  /**
   * Render members list table
   */
  function renderMembersList(members, teamName) {
    console.log('[TEAM] renderMembersList called with:', members);

    if (!members || members.length === 0) {
      teamMembersList.innerHTML = '<p style="color:#64748b;">No members in this team</p>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'team-members-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th>${t('team.table.name')}</th>
          <th>${t('team.table.email')}</th>
          <th>${t('team.table.role')}</th>
          <th>${t('team.table.team')}</th>
        </tr>
      </thead>
      <tbody>
        ${members.map(member => {
          console.log('[TEAM] Processing member:', member);
          // API returns full role names: 'Admin', 'Member', 'Developer', 'Owner'
          const apiRole = member.role || 'Member';
          const roleClass = apiRole === 'Admin' ? 'admin' : apiRole === 'Owner' ? 'owner' : apiRole === 'Developer' ? 'developer' : 'member';

          // Translate role names
          const roleKey = apiRole.toLowerCase();
          const roleName = t(`team.role.${roleKey}`) || apiRole;

          const name = member.email_address ? member.email_address.split('@')[0] : 'Unknown';

          return `
            <tr>
              <td>${name}</td>
              <td>${member.email_address || '—'}</td>
              <td><span class="role-badge ${roleClass}">${roleName}</span></td>
              <td>${teamName}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    `;

    teamMembersList.innerHTML = `<h3 style="margin-bottom:16px;color:#1e293b;">${t('team.members_title')}</h3>`;
    teamMembersList.appendChild(table);
    console.log('[TEAM] Table appended to teamMembersList:', teamMembersList);
  }

  /**
   * Check if team has children and show/hide arrow accordingly
   */
  async function checkForChildren(teamId, card) {
    try {
      const res = await teamFetch(`/api/team/${teamId}/sub_teams`);
      const data = await res.json();

      if (!res.ok) {
        return; // On error, leave arrow hidden
      }

      const hasChildren = data.sub_teams && data.sub_teams.length > 0;
      const icon = card.querySelector('.expand-icon');

      if (icon) {
        icon.style.display = hasChildren ? 'inline' : 'none';
      }
    } catch (err) {
      console.error('[TEAM] Error checking for children:', err);
      // On error, leave arrow hidden
    }
  }

  /**
   * Load member count for a team and update the card
   */
  async function loadMemberCount(teamId, card) {
    try {
      const res = await teamFetch(`/api/team/${teamId}/members`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load members');
      }

      const count = data.members?.length || 0;
      const countElement = card.querySelector('.team-node-count');
      if (countElement) {
        const memberText = count === 1 ? t('team.member') : t('team.members');
        countElement.innerHTML = `${count} ${memberText}`;
      }
    } catch (err) {
      console.error('[TEAM] Error loading member count:', err);
      const countElement = card.querySelector('.team-node-count');
      if (countElement) {
        countElement.innerHTML = '—';
      }
    }
  }

  /**
   * Load members for a specific team
   */
  async function loadTeamMembers(teamId, teamName) {
    console.log('[TEAM] Loading members for:', teamName, teamId);

    // Show loading state
    teamMembersList.innerHTML = '<p style="color:#64748b;font-style:italic;">Loading members...</p>';

    try {
      const res = await teamFetch(`/api/team/${teamId}/members`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load members');
      }

      console.log('[TEAM] Loaded members:', data);
      renderMembersList(data.members || [], teamName);

    } catch (err) {
      console.error('[TEAM] Error loading members:', err);
      teamMembersList.innerHTML = `<p style="color:#dc2626;">Failed to load members: ${err.message}</p>`;
    }
  }

  /**
   * Update team selection state and Delete button
   */
  function updateTeamSelection(clickedCard, teamId, teamName, childrenContainer) {
    console.log('[TEAM] Updating selection:', teamName);

    // Update selected state visually
    document.querySelectorAll('.team-node').forEach(node => {
      node.classList.remove('selected');
    });
    clickedCard.classList.add('selected');

    // Store selection state
    selectedTeamId = teamId;
    selectedTeamName = teamName;

    console.log('[TEAM] Selection state:', {
      teamId,
      teamName
    });
  }

  /**
   * Collapse all expanded teams
   */
  function collapseAllTeams() {
    console.log('[TEAM] Collapsing all expanded teams');
    const allExpanded = document.querySelectorAll('.team-node-wrapper.expanded');
    allExpanded.forEach(wrapper => {
      wrapper.classList.remove('expanded');
      const icon = wrapper.querySelector('.expand-icon');
      if (icon) {
        icon.textContent = '▶';
      }
    });
  }

  // Event listeners
  if (refreshTeamBtn) {
    refreshTeamBtn.addEventListener('click', loadTeamData);
  }

  if (collapseAllTeamsBtn) {
    collapseAllTeamsBtn.addEventListener('click', collapseAllTeams);
  }

  // Load when tab is activated
  const teamTabBtn = document.querySelector('[data-tab="tab-team"]');
  if (teamTabBtn) {
    teamTabBtn.addEventListener('click', () => {
      if (!teamData) {
        loadTeamData();
      }
    });
  }

})();
