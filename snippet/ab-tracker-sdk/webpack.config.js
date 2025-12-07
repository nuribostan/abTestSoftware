const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  mode: "production", // 'development' yaparsan kodu okunaklı çıkarır
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "ab-sdk.min.js",
    path: path.resolve(__dirname, "dist"),
  },
};
