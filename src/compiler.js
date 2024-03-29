const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");
const marked = require("marked");
const ejs = require("ejs");
const { minify } = require("html-minifier");
const sass = require("node-sass");
const Prism = require("prismjs");
const loadLanguages = require("prismjs/components/");

const config = require("./config")();

loadLanguages(config.HIGHLIGHT);

/**
 * Compile all posts
 */
module.exports = async function compile() {
  // Clean
  await fs.remove(config.PUBLIC_PATH);
  await fs.ensureDir(config.PUBLIC_PATH);

  // Posts
  const posts = await getPosts();
  await Promise.all(posts.map(post => compilePost(post)));

  // Sort posts by date, descending
  posts.sort((a, b) => b.headers.published - a.headers.published);

  // Index
  await writeTemplate(
    "index",
    {
      title: config.TITLE,
      url: config.URL,
      posts,
      archive: groupByYear(posts.filter(p => !p.unlisted))
    },
    path.join(config.PUBLIC_PATH, "index.html")
  );
  const assets = (await fs.readdir(config.TEMPLATES_PATH)).filter(f =>
    [".jpg", ".png", ".svg", ".gif", ".js", ".css"].includes(path.extname(f))
  );
  for (const asset of assets.concat(config.FILES)) {
    await fs.copyFile(path.join(config.TEMPLATES_PATH, asset), path.join(config.PUBLIC_PATH, asset));
  }

  // Tags
  const tags = groupByTag(posts);
  await Promise.all(
    Object.keys(tags).map(tag =>
      writeTemplate(
        "tag",
        {
          title: config.TITLE,
          url: config.URL,
          tag,
          posts: tags[tag]
        },
        path.join(config.PUBLIC_PATH, "tags", tag, "index.html")
      )
    )
  );

  // Write any extra pages
  let pages = config.PAGES;
  await Promise.all(
    pages.map(page => {
      return writeTemplate(
        page,
        {
          title: config.TITLE,
          url: config.URL,
          posts,
          archive: groupByYear(posts.filter(p => !p.unlisted))
        },
        path.join(config.PUBLIC_PATH, page + "/index.html")
      );
    })
  );

  // Sitemap
  await writeTemplate(
    "sitemap",
    { title: config.TITLE, url: config.URL, posts, pages },
    path.join(config.PUBLIC_PATH, "sitemap.xml")
  );

  // Robots
  await fs.writeFile(path.join(config.PUBLIC_PATH, "robots.txt"), "");

  // Ignore trash
  await fs.writeFile(path.join(config.PUBLIC_PATH, ".gitignore"), ".DS_Store\nThumbs.db\nnode_modules");
};

/**
 * Extract unique words from a body of text
 * @param {string} text Some content
 * @returns {array<string>} The unique words
 */
function uniqueWords(text) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\<.*?\>/g, "")
    .replace(/[^a-z0-9\s]+/g, "")
    .split(/[\s\n]/)
    .filter(w => w.length >= 3)
    .reduce((words, current) => words.concat(words.includes(current) ? null : current), [])
    .filter(w => w);
}

/**
 * Load posts from file
 * @returns {array<object>} The list of posts
 */
async function getPosts() {
  const folders = await fs.readdir(config.POSTS_PATH);
  return (
    await Promise.all(
      folders.map(async slug => {
        let post = {
          path: path.join(config.POSTS_PATH, slug),
          slug
        };

        // Not a directory
        if (!(await fs.stat(post.path)).isDirectory()) return null;

        const postFile = path.join(post.path, slug) + ".text";

        // No text file to read
        if (!(await fs.exists(postFile))) return null;

        const text = await fs.readFile(postFile, "utf8");
        let tokens = await marked.lexer(text);

        // Extract the title
        post.title = tokens.splice(
          tokens.findIndex(t => t.type === "heading"),
          1
        )[0].text;

        // Extract headers
        let headerTokens = tokens[0].type === "list" ? tokens.shift().items : [];
        post.headers = {};
        headerTokens
          .filter(t => typeof t.text !== "undefined")
          .forEach(t => {
            let [key, value] = t.text.split(/\:\s/);

            switch (key) {
              case "published":
                value = new Date(value);
                break;
              case "tags":
                value = value.split(/\,\s/);
                break;
            }

            if (value === "true" || value === "yes") value = true;
            if (value === "false" || value === "no") value = false;

            post.headers[key] = value;
          });

        // Share image
        if (post.headers.share) {
          if (!post.headers.share.match(/^http/) && !post.headers.share.match(/^\//)) {
            post.headers.share = `https://nathanhoad.net/${post.slug}/${post.headers.share}`;
          }
        } else {
          if (post.headers.tags && post.headers.tags.includes("painting")) {
            post.headers.share = "https://nathanhoad.net/share-painting.jpg";
          } else {
            post.headers.share = "https://nathanhoad.net/share.jpg";
          }
        }

        // Share description
        if (!post.headers.description) {
          post.headers.description = tokens
            .find(t => t.type === "paragraph")
            .text.replace(/\(.*\)/g, "")
            .replace(/[\[\]]/g, "")
            .replace(/\n/g, "");

          if (post.headers.description.length >= 200) {
            post.headers.description = post.headers.description.slice(0, 200) + "...";
          }
        }

        post.html = highlightCode(await marked.parser(tokens));
        post.uniqueWords = uniqueWords(text);

        return post;
      })
    )
  ).filter(p => p);
}

/**
 * Replaces raw code with marked up code for highlighting
 * @param {string} html
 */
function highlightCode(html) {
  return html.replace(/<pre><code class="language-(.*?)">((.|\n)*?)<\/code><\/pre>/g, (found, language, code) => {
    // Unencode html entities so Prism knows what they actually are
    code = code
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Highlight
    code = Prism.highlight(code, Prism.languages[language], language);

    // Give control keywords another class so we can target them for styling separately to normal keywords
    ["if", "elif", "else", "for", "foreach", "in", "do", "while", "continue", "break", "return"].forEach(control => {
      code = code.replace(
        new RegExp(`<span class="token keyword">${control}</span>`, "g"),
        `<span class="token keyword control">${control}</span>`
      );
    });

    return `<pre class="language-${language}"><code class="language-${language}">${code}</code></pre>`;
  });
}

/**
 * Sort and group posts by their year
 * @param {array} posts The list of posts
 */
function groupByYear(posts) {
  let archive = {};
  posts.forEach(p => {
    archive[p.headers.published.getFullYear()] = archive[p.headers.published.getFullYear()] || [];
    archive[p.headers.published.getFullYear()].push(p);
  });

  return archive;
}

/**
 * Group posts by their tag
 * @param {array} posts The list of posts
 */
function groupByTag(posts) {
  let tags = [];
  posts.forEach(p => {
    p.headers.tags.forEach(t => {
      tags[t] = tags[t] || [];
      tags[t].push(p);
    });
  });

  return tags;
}

/**
 * Compile a single post
 * @param {object} post The post to compile
 */
async function compilePost(post) {
  if (post.format === "html") {
    await writeTemplate(
      null,
      { title: config.TITLE, url: config.URL, html: post.html },
      path.join(config.PUBLIC_PATH, post.slug, "index.html")
    );
  } else {
    await writeTemplate(
      "post",
      { title: config.TITLE, url: config.URL, post },
      path.join(config.PUBLIC_PATH, post.slug, "index.html")
    );
  }

  // Copy any other files over
  (await fs.readdir(post.path)).forEach(async file => {
    if (file === post.slug + ".text" || file === "index.html") return;
    await fs.copyFile(path.join(post.path, file), path.join(config.PUBLIC_PATH, post.slug, file));
  });

  if (!post.headers.published) {
    console.log(chalk.yellow(`${post.title} is not published`));
    return;
  }
}

/**
 * Render a template and save it to a file
 * @param {string} templateName The name of the EJS template file
 * @param {object} data A hash of locals to pass into the template
 * @param {string} toPath The filename to save this file to
 */
async function writeTemplate(templateName, data, toPath) {
  let templateContent;
  if (templateName === null) {
    templateContent = "<%- html %>";
  } else {
    templateContent = await fs.readFile(path.join(config.TEMPLATES_PATH, templateName + ".ejs"), "utf8");
    // Include sass
    const css = await renderSass(path.join(config.TEMPLATES_PATH, "styles.scss"));
    templateContent = templateContent.replace("</head>", `<style type="text/css">${css}</style></head>`);
  }

  templateContent = minify(templateContent, {
    minifyCSS: true,
    minifyJS: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    maxLineLength: 256
  });

  try {
    await fs.ensureDir(path.join(path.dirname(toPath)));
    await fs.writeFile(
      toPath,
      ejs.render(templateContent, data, {
        views: [config.TEMPLATES_PATH],
        rmWhitespace: true
      })
    );
  } catch (ex) {
    console.log("Error:", ex);
    process.exit();
  }
}

/**
 * Render a sass file to string
 * @param {string} file The path to the scss file
 */
function renderSass(file) {
  return new Promise((resolve, reject) => {
    sass.render({ file }, (err, result) => {
      if (err) return reject(err);
      resolve(result.css);
    });
  });
}
