module.exports = {
  extends: 'airbnb-base',
  parser: 'babel-eslint',
  parserOptions: { sourceType: 'module' },
  installedESLint: true,
  env: {
    node: false,
    browser: true,
  },
  plugins: ['import'],
};
