'use strict';

const crypto = require('crypto');
const path = require('path');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function domainToBaseDn(domain) {
  return domain
    .split('.')
    .filter(Boolean)
    .map((part) => `DC=${part}`)
    .join(',');
}

const env = process.env;

const ldapDomain = (env.LDAP_DOMAIN || '').trim();
const ldapBaseDn = (env.LDAP_BASE_DN || (ldapDomain ? domainToBaseDn(ldapDomain) : '')).trim();

let sessionSecret = env.SESSION_SECRET;
let sessionSecretGenerated = false;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  sessionSecretGenerated = true;
}

const config = {
  port: parseInt(env.PORT || '3000', 10),
  dataDir: path.resolve(env.DATA_DIR || '/data'),
  siteTitle: env.SITE_TITLE || 'Dashboard',
  trustProxy: bool(env.TRUST_PROXY, false),
  cookieSecure: bool(env.COOKIE_SECURE, false),
  sessionSecret,
  sessionSecretGenerated,
  sessionMaxAgeMinutes: parseInt(env.SESSION_MAX_AGE_MINUTES || '480', 10),
  maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '10', 10),

  ldap: {
    url: (env.LDAP_URL || '').trim(),
    domain: ldapDomain,
    baseDn: ldapBaseDn,
    adminGroupDn: (env.LDAP_ADMIN_GROUP_DN || (ldapBaseDn ? `CN=Administrators,CN=Builtin,${ldapBaseDn}` : '')).trim(),
    startTls: bool(env.LDAP_STARTTLS, false),
    tlsRejectUnauthorized: bool(env.LDAP_TLS_REJECT_UNAUTHORIZED, true),
    caCertPath: (env.LDAP_CA_CERT || '').trim(),
    timeoutMs: parseInt(env.LDAP_TIMEOUT_MS || '5000', 10),
  },

  // Optional break-glass account (disabled unless both are set).
  localAdmin: {
    user: env.LOCAL_ADMIN_USER || '',
    password: env.LOCAL_ADMIN_PASSWORD || '',
  },
};

// LDAP_URL may list several servers separated by commas or spaces (tried in order).
config.ldap.urls = config.ldap.url.split(/[\s,]+/).filter(Boolean);
config.ldap.enabled = Boolean(config.ldap.urls.length && config.ldap.baseDn);
config.localAdmin.enabled = Boolean(config.localAdmin.user && config.localAdmin.password);

module.exports = config;
