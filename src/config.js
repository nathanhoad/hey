const path = require("path");
const fs = require("fs-extra");
const Chalk = require("chalk");

function config() {
  const expectedConfigPath = path.join(process.cwd(), "hey.json");

  if (!fs.existsSync(expectedConfigPath)) {
    console.log(Chalk.red("You are missing a hey.json config file."));
    process.exit();
  }

  const conf = require(expectedConfigPath);

  return {
    TITLE: conf.title,
    URL: conf.url,
    POSTS_PATH: path.join(process.cwd(), conf.posts),
    PUBLIC_PATH: path.join(process.cwd(), conf.public),
    TEMPLATES_PATH: path.join(process.cwd(), conf.templates),
    PAGES: typeof conf.pages !== "undefined" ? conf.pages : [],
    FILES: typeof conf.files !== "undefined" ? conf.files : [],
    HIGHLIGHT: typeof conf.highlight !== "undefined" ? conf.highlight : []
  };
}

module.exports = config;
