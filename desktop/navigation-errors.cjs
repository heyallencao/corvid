const { createMainLocale } = require('./main-locales.cjs');

function navigationFailureCode(errorCode, detail = '') {
  const chromiumCode = String(detail).trim().toUpperCase().match(/^(?:NET::)?(ERR_[A-Z0-9_]+)\b/)?.[1];
  if (chromiumCode) return chromiumCode;
  return Number.isInteger(errorCode) && errorCode < 0 ? String(errorCode) : null;
}

function navigationFailureDetails(errorCode, detail = '', locale = 'zh-CN') {
  const code = navigationFailureCode(errorCode, detail);
  const messages = typeof locale === 'string' ? createMainLocale(locale) : locale;
  let message;
  if (errorCode === -105 || code === 'ERR_NAME_NOT_RESOLVED') message = messages.t('navigationServerNotFound');
  else if (errorCode === -106 || code === 'ERR_INTERNET_DISCONNECTED') message = messages.t('navigationNetworkDisconnected');
  else if (errorCode === -102 || code === 'ERR_CONNECTION_REFUSED') message = messages.t('navigationServerRefused');
  else if (errorCode === -118 || code === 'ERR_TIMED_OUT') message = messages.t('navigationTimedOut');
  else if ((errorCode <= -200 && errorCode >= -299) || code?.startsWith('ERR_CERT_')) message = messages.t('navigationSecureConnectionFailed');
  else message = messages.t('navigationLoadFailed');
  return { message, code };
}

function navigationHttpStatusFailure(statusCode, locale = 'zh-CN') {
  const messages = typeof locale === 'string' ? createMainLocale(locale) : locale;
  return { message: messages.t('navigationHttpStatusFailure', { statusCode }), code: `HTTP ${statusCode}` };
}

function navigationFailureMessage(errorCode, detail = '', locale = 'zh-CN') {
  return navigationFailureDetails(errorCode, detail, locale).message;
}

module.exports = { navigationFailureCode, navigationFailureDetails, navigationFailureMessage, navigationHttpStatusFailure };
