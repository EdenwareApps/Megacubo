module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: {
          chrome: "41"
        }
      }
    ]
  ],
  plugins: [
    "@babel/plugin-transform-object-rest-spread"
  ]
};