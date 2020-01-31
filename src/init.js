const path = require("path");
const fs = require("fs-extra");
const chalk = require("chalk");

function init() {
  copy("hey.json");
  copy("templates");
  copy("posts");
}

function copy(filename) {
  const dest = path.join(process.cwd(), filename);
  if (!fs.existsSync(dest)) {
    fs.copySync(path.join(__dirname, "blank-project", filename), dest);
    console.log(chalk.green.bold("created"), filename);
  } else {
    console.log(chalk.yellow.bold("exists"), filename);
  }
}

module.exports = init;
