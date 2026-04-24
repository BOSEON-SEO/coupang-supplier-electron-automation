const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

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
        exclude: /node_modules/,
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
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
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
