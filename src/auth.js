'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { Client, InvalidCredentialsError } = require('ldapts');
const config = require('./config');

// RFC 4515 escaping for values placed inside an LDAP filter.
function escapeFilter(value) {
  return String(value).replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// Accepts "user", "DOMAIN\user" or "user@domain" and returns
// { bindName, samAccountName }.
function normalizeUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (raw.includes('\\')) {
    const sam = raw.split('\\').pop();
    return { bindName: raw, samAccountName: sam };
  }
  if (raw.includes('@')) {
    return { bindName: raw, samAccountName: raw.split('@')[0], upn: raw };
  }
  const bindName = config.ldap.domain ? `${raw}@${config.ldap.domain}` : raw;
  return { bindName, samAccountName: raw };
}

function tlsOptions() {
  const opts = { rejectUnauthorized: config.ldap.tlsRejectUnauthorized };
  if (config.ldap.caCertPath) {
    opts.ca = [fs.readFileSync(config.ldap.caCertPath)];
  }
  return opts;
}

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Authenticates a user and verifies admin group membership.
 * Returns { username, displayName, source } on success, null on failure.
 */
async function authenticate(username, password) {
  if (!username || !password) return null;

  if (
    config.localAdmin.enabled &&
    timingSafeEqualStr(username, config.localAdmin.user) &&
    timingSafeEqualStr(password, config.localAdmin.password)
  ) {
    return { username: config.localAdmin.user, displayName: config.localAdmin.user, source: 'local' };
  }

  if (!config.ldap.enabled) return null;

  const user = normalizeUsername(username);
  if (!user) return null;

  // Try each configured server until one answers (failover).
  let client = null;
  for (const url of config.ldap.urls) {
    const isLdaps = url.toLowerCase().startsWith('ldaps://');
    const candidate = new Client({
      url,
      timeout: config.ldap.timeoutMs,
      connectTimeout: config.ldap.timeoutMs,
      tlsOptions: isLdaps ? tlsOptions() : undefined,
    });
    try {
      if (config.ldap.startTls && !isLdaps) {
        await candidate.startTLS(tlsOptions());
      }
      await candidate.bind(user.bindName, password);
      client = candidate;
      break;
    } catch (err) {
      await candidate.unbind().catch(() => {});
      if (err instanceof InvalidCredentialsError) return null;
      console.error(`[auth] LDAP server ${url} failed: ${err.message}`);
    }
  }
  if (!client) return null;

  try {
    const accountFilter = user.upn
      ? `(|(userPrincipalName=${escapeFilter(user.upn)})(sAMAccountName=${escapeFilter(user.samAccountName)}))`
      : `(sAMAccountName=${escapeFilter(user.samAccountName)})`;

    // LDAP_MATCHING_RULE_IN_CHAIN resolves nested membership
    // (e.g. Domain Admins -> Administrators).
    const filter =
      `(&(objectCategory=person)(objectClass=user)${accountFilter}` +
      `(memberOf:1.2.840.113556.1.4.1941:=${escapeFilter(config.ldap.adminGroupDn)}))`;

    const { searchEntries } = await client.search(config.ldap.baseDn, {
      scope: 'sub',
      filter,
      attributes: ['sAMAccountName', 'displayName', 'memberOf'],
      sizeLimit: 2,
    });

    let entry = searchEntries[0];

    if (!entry) {
      // Fallback: direct memberOf comparison (for directories without the in-chain rule).
      const res = await client.search(config.ldap.baseDn, {
        scope: 'sub',
        filter: `(&(objectClass=user)${accountFilter})`,
        attributes: ['sAMAccountName', 'displayName', 'memberOf'],
        sizeLimit: 2,
      });
      const candidate = res.searchEntries[0];
      if (candidate) {
        const groups = [].concat(candidate.memberOf || []).map((g) => String(g).toLowerCase());
        if (groups.includes(config.ldap.adminGroupDn.toLowerCase())) entry = candidate;
      }
    }

    if (!entry) return null;

    return {
      username: String(entry.sAMAccountName || user.samAccountName),
      displayName: String(entry.displayName || entry.sAMAccountName || user.samAccountName),
      source: 'ldap',
    };
  } catch (err) {
    console.error(`[auth] LDAP error: ${err.message}`);
    return null;
  } finally {
    try {
      await client.unbind();
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { authenticate, escapeFilter, normalizeUsername };
