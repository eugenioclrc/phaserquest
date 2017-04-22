const path = require('path');
const autoprefixer = require('autoprefixer');
// const ExtractTextPlugin = require('extract-text-webpack-plugin');
const webpack = require('webpack');
const FriendlyErrors = require('friendly-errors-webpack-plugin');

module.exports = {
  devtool: '#source-map',
  entry: {
    app: './src/entry-game.js',
    vendor: [
      'pixi',
      'phaser',
    ],
  },
  output: {
    path: path.resolve(__dirname, '../dist'),
    publicPath: '/dist/',
    filename: '[name].[chunkhash].js',
  },
  resolve: {
    alias: {
      public: path.resolve(__dirname, '../public'),
    },
    modules: [path.join(__dirname, 'node_modules'), path.resolve(__dirname, '../src')],
  },
  module: {
    noParse: /es6-promise\.js$/, // avoid webpack shimming process
    rules: [
      /*{
        test: /\.js$/,
        loader: 'eslint-loader',
        exclude: /(node_modules|build)/,
        enforce: 'pre',
      },*/
      {
        test: /\.js$/,
        loader: 'babel-loader',
        /*
        buble anda para atras a veces (sobre todo con los rest operators)
        loader: 'buble-loader',
        options: {
          objectAssign: 'Object.assign'
        },*/
        exclude: /node_modules/,
      },
      {
        test: /\.(png|jpg|gif|svg)$/,
        loader: 'url-loader',
        options: {
          limit: 10000,
          name: '[name].[ext]?[hash]',
        },
      },
      {
        test: /\.scss$/,
        use: [
          {
            loader: 'css-loader',
            options: {
              minimize: true,
            },
          }, {
            loader: 'postcss-loader',
            options: {
              plugins: () => [
                autoprefixer({ browsers: ['last 2 versions'] }),
              ],
            },
          },
          'sass-loader',
        ],
      },
      {
        test: /\.(ttf|otf|eot|svg|woff(2)?)(\?[a-z0-9]+)?$/,
        loader: 'file-loader?name=fonts/[name].[ext]',
      },
    ],
  },
  plugins: [
    new webpack.NoEmitOnErrorsPlugin(),
    new FriendlyErrors(),
  ],
  performance: {
    hints: process.env.NODE_ENV === 'production' ? 'warning' : false,
  },
};
