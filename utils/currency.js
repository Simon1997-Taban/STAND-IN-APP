const DEFAULT_CURRENCY = 'USD';

const SUPPORTED_CURRENCIES = [
  { code: 'UGX', label: 'Ugandan Shilling', symbol: 'USh', rate: 3850 },
  { code: 'KES', label: 'Kenyan Shilling', symbol: 'KSh', rate: 129 },
  { code: 'TZS', label: 'Tanzanian Shilling', symbol: 'TSh', rate: 2580 },
  { code: 'RWF', label: 'Rwandan Franc', symbol: 'RF', rate: 1295 },
  { code: 'BIF', label: 'Burundian Franc', symbol: 'FBu', rate: 2890 },
  { code: 'SSP', label: 'South Sudanese Pound', symbol: 'SSP', rate: 1630 },
  { code: 'USD', label: 'US Dollar', symbol: '$', rate: 1 },
  { code: 'GBP', label: 'British Pound', symbol: 'PS', rate: 0.79 }
];

function normalizeCurrency(code) {
  return String(code || DEFAULT_CURRENCY).trim().toUpperCase();
}

function getCurrencyInfo(code) {
  const normalizedCode = normalizeCurrency(code);
  return SUPPORTED_CURRENCIES.find((currency) => currency.code === normalizedCode)
    || SUPPORTED_CURRENCIES.find((currency) => currency.code === DEFAULT_CURRENCY);
}

function isSupportedCurrency(code) {
  return Boolean(SUPPORTED_CURRENCIES.find((currency) => currency.code === normalizeCurrency(code)));
}

function getExchangeRate(code) {
  return getCurrencyInfo(code).rate;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function convertFromUsd(amountUsd, currencyCode) {
  return roundMoney(Number(amountUsd || 0) * getExchangeRate(currencyCode));
}

module.exports = {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  normalizeCurrency,
  getCurrencyInfo,
  getExchangeRate,
  convertFromUsd,
  isSupportedCurrency,
  roundMoney
};
