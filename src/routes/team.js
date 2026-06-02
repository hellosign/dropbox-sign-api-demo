// src/routes/team.js
import { Router } from 'express';
import express from 'express';
import https from 'https';
import { requireAuth } from '../middleware/auth.js';
import { apiCall } from '../services/dropbox-sign.js';
import { decryptApiKey } from '../utils/crypto.js';
import { VERBOSE_LOGGING } from '../config/security.js';
import { buildRequestDetail } from '../utils/logging.js';

const router = Router();

/**
 * GET /api/team/debug - Debug endpoint for team hierarchy
 * Returns detailed team info, members, and sub-teams
 */
router.get('/debug', requireAuth, async (req, res) => {
  const { addApiLog } = req.app.locals.redisHelpers;

  try {
    if (VERBOSE_LOGGING) console.log('[TEAM-DEBUG] Fetching team hierarchy for user:', req.session.accountInfo?.email_address);

    // Get current user's account info
    const accountResp = await apiCall(req, 'AccountApi', 'accountGet', [], {
      method: 'GET',
      endpoint: '/account'
    });
    const userInfo = {
      email: accountResp.body?.account?.emailAddress,
      account_id: accountResp.body?.account?.accountId,
      role: accountResp.body?.account?.roleCode,
      team_id: accountResp.body?.account?.teamId,
    };

    if (VERBOSE_LOGGING) console.log('[TEAM-DEBUG] User info:', userInfo);

    // Check if user is part of a team
    if (!userInfo.team_id) {
      if (VERBOSE_LOGGING) console.log('[TEAM-DEBUG] User is not part of a team');
      return res.json({
        current_user: userInfo,
        current_team: null,
        team_members: [],
        sub_teams: [],
        can_access_team_api: false,
        not_in_team: true,
      });
    }

    // Get team info
    const teamInfoResp = await apiCall(req, 'TeamApi', 'teamInfo', [], {
      method: 'GET',
      endpoint: '/team'
    });

    const teamInfo = {
      team_id: teamInfoResp.body?.team?.teamId,
      name: teamInfoResp.body?.team?.name,
      num_members: teamInfoResp.body?.team?.numMembers,
    };

    // Get team members
    const membersResp = await apiCall(req, 'TeamApi', 'teamMembers', [teamInfo.team_id, 1, 100], {
      method: 'GET',
      endpoint: `/team/members`
    });
    const members = (membersResp.body?.teamMembers || []).map(m => ({
      email_address: m.emailAddress,
      account_id: m.accountId,
      role: m.role,
      team_id: m.teamId,
    }));

    // Get sub-teams using direct API call (SDK method may not work)
    let subTeams = [];
    try {
      if (VERBOSE_LOGGING) console.log(`[TEAM-DEBUG] Fetching sub-teams for team_id: ${teamInfo.team_id}`);

      const apiKey = decryptApiKey(req.session.apiKey);
      const auth = Buffer.from(`${apiKey}:`).toString('base64');

      const subTeamsData = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.hellosign.com',
          path: `/v3/team/sub_teams/${teamInfo.team_id}`,
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        };

        https.get(options, (res) => {
          if (VERBOSE_LOGGING) console.log(`[TEAM-DEBUG] Sub-teams API status: ${res.statusCode}`);
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error('Failed to parse sub-teams response'));
            }
          });
        }).on('error', (err) => reject(err));
      });

      addApiLog({
        type: 'api_response',
        method: 'GET',
        endpoint: `/team/sub_teams/${teamInfo.team_id}`,
        requestBody: buildRequestDetail({ method: 'GET', apiPath: `/team/sub_teams/${teamInfo.team_id}` }),
        response: JSON.parse(JSON.stringify(subTeamsData || {})),
      }, null, req);

      subTeams = (subTeamsData?.sub_teams || []).map(st => ({
        team_id: st.team_id,
        name: st.name,
        num_members: null,
        members: [],
        has_sub_teams: false,
      }));

      if (VERBOSE_LOGGING) console.log(`[TEAM-DEBUG] Loaded ${subTeams.length} sub-teams`);
    } catch (err) {
      if (VERBOSE_LOGGING) console.log('[TEAM-DEBUG] Error fetching sub-teams:', err?.message);
      subTeams = []; // Keep as empty array on error
    }

    res.json({
      current_user: userInfo,
      current_team: teamInfo,
      team_members: members,
      sub_teams: subTeams,
      can_access_team_api: true,
    });

  } catch (err) {
    const errorMsg = err?.body?.error?.errorMsg || err?.message;
    console.error('[TEAM-DEBUG] Error:', errorMsg);

    // Check if it's an upgrade/team API access error
    const requiresTeamApi = errorMsg?.toLowerCase().includes('upgrade') || errorMsg?.toLowerCase().includes('team');

    res.status(err?.statusCode || 500).json({
      error: requiresTeamApi ? 'Team API access not enabled' : 'Failed to fetch team debug info',
      details: errorMsg,
      requiresTeamApi: requiresTeamApi,
      can_access_team_api: false,
    });
  }
});

/**
 * GET /api/team/members - Fetch all team members
 * Returns list of team members with email, account_id, and role
 */
router.get('/members', requireAuth, async (req, res) => {
  try {
    if (VERBOSE_LOGGING) console.log('[TEAM] Attempting to fetch team info...');
    // Get team info first to get team_id
    const teamInfoResp = await apiCall(req, 'TeamApi', 'teamInfo', [], {
      method: 'GET',
      endpoint: '/team'
    });
    if (VERBOSE_LOGGING) console.log('[TEAM] Team info status:', teamInfoResp.response?.statusCode);
    if (VERBOSE_LOGGING) console.log('[TEAM] Team info body:', JSON.stringify(teamInfoResp.body, null, 2));

    const teamId = teamInfoResp.body?.team?.teamId;
    const teamName = teamInfoResp.body?.team?.name;

    if (!teamId) {
      return res.status(404).json({ error: "No team found for this user" });
    }

    // Fetch all team members
    const membersResp = await apiCall(req, 'TeamApi', 'teamMembers', [teamId, 1, 100], {
      method: 'GET',
      endpoint: '/team/members'
    });
    const members = (membersResp.body?.teamMembers || []).map(m => ({
      account_id: m.accountId,
      email_address: m.emailAddress,
      role: m.role
    }));

    res.json({ members, team_id: teamId, team_name: teamName });
  } catch (err) {
    console.error("[TEAM] Error fetching team members:", err?.message);
    console.error("[TEAM] Error statusCode:", err?.statusCode);
    console.error("[TEAM] Error body:", err?.body);

    const apiError = err?.body?.error?.errorMsg || err?.body?.error_msg || 'Unknown API error';
    res.status(err?.statusCode || 500).json({
      error: "Failed to fetch team members",
      details: err?.message,
      apiError: apiError,
      statusCode: err?.statusCode
    });
  }
});

/**
 * GET /api/team/:teamId/members - Fetch members for a specific team
 */
router.get('/:teamId/members', requireAuth, async (req, res) => {
  const { teamId } = req.params;

  try {
    if (VERBOSE_LOGGING) console.log(`[TEAM] Fetching members for team_id: ${teamId}`);

    // Fetch team members
    const membersResp = await apiCall(req, 'TeamApi', 'teamMembers', [teamId, 1, 100], {
      method: 'GET',
      endpoint: `/team/members`
    });

    const members = (membersResp.body?.teamMembers || []).map(m => {
      if (VERBOSE_LOGGING) console.log(`[TEAM] Raw member data:`, {
        accountId: m.accountId,
        emailAddress: m.emailAddress,
        role: m.role,
        roleCode: m.roleCode,
        allFields: Object.keys(m)
      });
      return {
        account_id: m.accountId,
        email_address: m.emailAddress,
        role: m.roleCode || m.role
      };
    });

    if (VERBOSE_LOGGING) console.log(`[TEAM] Found ${members.length} members for team ${teamId}`);

    res.json({ members });
  } catch (err) {
    console.error(`[TEAM] Error fetching members for team ${teamId}:`, err?.message);
    res.status(err?.statusCode || 500).json({
      error: "Failed to fetch team members",
      details: err?.message
    });
  }
});

/**
 * GET /api/team/:teamId/sub_teams - Fetch sub-teams for a specific team
 * Uses direct HTTPS request since SDK method may not be available
 */
router.get('/:teamId/sub_teams', requireAuth, async (req, res) => {
  const { teamId } = req.params;
  const { addApiLog } = req.app.locals.redisHelpers;

  if (VERBOSE_LOGGING) console.log(`[TEAM] Fetching sub-teams for team_id: ${teamId}`);

  try {
    const apiKey = decryptApiKey(req.session.apiKey);
    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    // Fetch sub-teams using GET /v3/team/sub_teams/{team_id}
    const subTeamsData = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.hellosign.com',
        path: `/v3/team/sub_teams/${teamId}`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      };

      https.get(options, (res) => {
        if (VERBOSE_LOGGING) console.log(`[TEAM] Sub-teams API status for ${teamId}: ${res.statusCode}`);
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Failed to parse sub-teams response'));
          }
        });
      }).on('error', (err) => reject(err));
    });

    addApiLog({
      type: 'api_response',
      method: 'GET',
      endpoint: `/team/sub_teams/${teamId}`,
      requestBody: buildRequestDetail({ method: 'GET', apiPath: `/team/sub_teams/${teamId}` }),
      response: JSON.parse(JSON.stringify(subTeamsData || {})),
    }, null, req);

    // Extract sub-teams
    const subTeams = (subTeamsData?.sub_teams || []).map(st => ({
      team_id: st.team_id,
      name: st.name,
    }));

    if (VERBOSE_LOGGING) console.log(`[TEAM] Found ${subTeams.length} sub-teams for team ${teamId}`);

    res.json({
      parent_team_id: teamId,
      sub_teams: subTeams,
      count: subTeams.length
    });

  } catch (err) {
    const errorMsg = err?.message || 'Failed to fetch sub-teams';
    console.error(`[TEAM] Error fetching sub-teams for team ${teamId}:`, errorMsg);

    addApiLog({
      type: 'api_error',
      method: 'GET',
      endpoint: `/team/sub_teams/${teamId}`,
      requestBody: buildRequestDetail({ method: 'GET', apiPath: `/team/sub_teams/${teamId}` }),
      error: errorMsg,
    }, null, req);

    res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /api/team/sub-teams - Fetch all sub-teams for current user's team
 * Uses SDK method teamSubTeams
 */
router.get('/sub-teams', requireAuth, async (req, res) => {
  try {
    // Get team info first to get team_id
    const teamInfoResp = await apiCall(req, 'TeamApi', 'teamInfo', [], {
      method: 'GET',
      endpoint: '/team'
    });
    const teamId = teamInfoResp.body?.team?.teamId;

    if (!teamId) {
      return res.status(404).json({ error: "No team found for this user" });
    }

    // Fetch sub-teams
    const subTeamsResp = await apiCall(req, 'TeamApi', 'teamSubTeams', [teamId, 1, 100], {
      method: 'GET',
      endpoint: '/team/sub_teams'
    });
    const subTeams = (subTeamsResp.body?.teams || []).map(t => ({
      team_id: t.teamId,
      name: t.name,
      member_count: t.numMembers || 0
    }));

    res.json({ sub_teams: subTeams, parent_team_id: teamId });
  } catch (err) {
    console.error("Error fetching sub-teams:", err?.message || err);
    res.status(500).json({ error: "Failed to fetch sub-teams", details: err?.message });
  }
});

/**
 * DELETE /api/team/:teamId - Delete main team
 * Can only delete the main team (when it has only one member - yourself)
 * The API does not support deleting sub-teams
 */
router.delete('/:teamId', requireAuth, async (req, res) => {
  const { teamId } = req.params;
  const { addApiLog } = req.app.locals.redisHelpers;

  if (VERBOSE_LOGGING) console.log('[TEAM] Delete request for team_id:', teamId);

  try {
    const apiKey = decryptApiKey(req.session.apiKey);
    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    // First check if team has children
    const checkChildrenData = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.hellosign.com',
        path: `/v3/team/sub_teams/${teamId}`,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      };

      https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Failed to parse response'));
          }
        });
      }).on('error', (err) => reject(err));
    });

    // Check if team has children
    if (checkChildrenData?.sub_teams && checkChildrenData.sub_teams.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete team with sub-teams',
        details: 'Team has sub-teams. Delete or move them first.',
        sub_teams_count: checkChildrenData.sub_teams.length
      });
    }

    // Delete the team using Dropbox Sign API - DELETE /v3/team/destroy
    const deleteData = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        team_id: teamId
      });

      const options = {
        hostname: 'api.hellosign.com',
        path: `/v3/team/destroy`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        if (VERBOSE_LOGGING) console.log(`[TEAM] Delete API status: ${res.statusCode}`);
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error?.error_msg || 'Failed to delete team'));
            } else {
              resolve(parsed);
            }
          } catch (err) {
            reject(new Error('Failed to parse delete response'));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    });

    addApiLog({
      type: 'api_response',
      method: 'POST',
      endpoint: `/team/destroy`,
      requestBody: buildRequestDetail({ method: 'POST', apiPath: `/team/destroy`, body: { team_id: teamId } }),
      response: JSON.parse(JSON.stringify(deleteData || {})),
    }, null, req);

    if (VERBOSE_LOGGING) console.log('[TEAM] Team deleted successfully:', teamId);

    res.json({
      success: true,
      message: 'Team deleted successfully',
      team_id: teamId
    });

  } catch (err) {
    const errorMsg = err?.message || 'Failed to delete team';
    console.error('[TEAM] Error deleting team:', errorMsg);

    addApiLog({
      type: 'api_error',
      method: 'POST',
      endpoint: `/team/destroy`,
      requestBody: buildRequestDetail({ method: 'POST', apiPath: `/team/destroy`, body: { team_id: teamId } }),
      error: errorMsg,
    }, null, req);

    res.status(500).json({ error: errorMsg });
  }
});

export default router;
