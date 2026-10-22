(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SubscriptionAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  var TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
  var PLANS = Object.freeze({
    maand: {label: 'Per maand', months: 1},
    halfjaar: {label: 'Per halfjaar', months: 6},
    jaar: {label: 'Per jaar', months: 12},
    levenslang: {label: 'Voor altijd', months: null}
  });

  function milliseconds(value) {
    if (value == null) return NaN;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') return Date.parse(value);
    if (Number.isFinite(value.seconds) && Number.isFinite(value.nanoseconds)) {
      return value.seconds * 1000 + value.nanoseconds / 1e6;
    }
    return NaN;
  }

  function accessState(config, access, now, administrator) {
    if (administrator === true) return {allowed: true, kind: 'admin', expiresAt: null};
    if (!config || config.enabled === false) return {allowed: true, kind: 'disabled', expiresAt: null};
    if (config.enabled !== true) return {allowed: false, kind: 'unavailable', expiresAt: null};
    if (!access) return {allowed: false, kind: 'missing', expiresAt: null};
    var paidStart = milliseconds(access.paidStartsAt);
    if (Number.isFinite(now) && paidStart > now &&
        (access.status === 'lifetime' || (access.status === 'active' && milliseconds(access.validUntil) > paidStart))) {
      return {allowed: true, kind: 'trial', expiresAt: paidStart};
    }
    if (access.status === 'free' || access.status === 'lifetime') {
      return {allowed: true, kind: access.status, expiresAt: null};
    }
    var start = milliseconds(access.trialStartedAt);
    var end = access.status === 'trial' ? start + TRIAL_MS :
      (access.status === 'active' ? milliseconds(access.validUntil) : NaN);
    var allowed = Number.isFinite(end) && Number.isFinite(now) && now < end;
    return {allowed: allowed, kind: allowed ? access.status : 'expired', expiresAt: Number.isFinite(end) ? end : null};
  }

  function planOptions(config) {
    return Object.keys(PLANS).map(function(id) {
      var configured = config && config.plans && config.plans[id];
      var cents = configured && configured.amountCents;
      return {id: id, label: PLANS[id].label, months: PLANS[id].months,
        amountCents: Number.isSafeInteger(cents) && cents > 0 ? cents : null};
    });
  }

  return Object.freeze({TRIAL_MS: TRIAL_MS, PLANS: PLANS, milliseconds: milliseconds,
    accessState: accessState, planOptions: planOptions});
});
