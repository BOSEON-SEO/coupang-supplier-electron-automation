const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const pkg = require('./package.json');

module.exports = (env, argv) => ({
  entry: './src/index.jsx',
  // dev/prod 공통: eval 계열 소스맵 금지 (CSP 'unsafe-eval' 회피)
  // - production: source-map (외부 .map 파일)
  // - development: cheap-module-source-map (eval 미사용, 빠른 빌드)
  devtool: argv.mode === 'production' ? 'source-map' : 'cheap-module-source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        // node_modules 는 기본 제외하되, 별도 repo 의 플러그인 패키지는
        // transpile 필요 (소스 그대로 배포).
        exclude: /node_modules\/(?!coupang-supplier-plugin-)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    // 별도 repo 로 분리된 플러그인이 core 모듈을 절대경로로 참조할 수 있게.
    // 예: import { KNOWN_HOOKS } from '@core/plugin-api'
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@components': path.resolve(__dirname, 'src/components'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
    new webpack.DefinePlugin({
      __APP_VERSION__: JSON.stringify(pkg.version),
    }),
  ],
  devServer: {
    port: 3100,
    hot: true,
    static: {
      directory: path.join(__dirname, 'public'),
    },
  },
});
