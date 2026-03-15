const path = require("path");
const fs = require("fs");
const MarkdownIt = require("markdown-it");
const { repoRoot } = require("./_data/tutorials.js");

const md = new MarkdownIt({ html: true });

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");

  // Render markdown from a file path (relative to repo root)
  eleventyConfig.addShortcode("renderChapter", function (relativePath) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath)) return `<p>Chapter file not found: ${relativePath}</p>`;
    const raw = fs.readFileSync(fullPath, "utf-8");
    return md.render(raw);
  });

  // Chapter slug from filename (e.g. chapter-01.md -> chapter-01)
  eleventyConfig.addFilter("chapterSlug", (filename) =>
    filename ? filename.replace(/\.md$/, "") : ""
  );

  return {
    dir: {
      input: ".",
      includes: "_includes",
      layouts: "_layouts",
      output: "build",
      data: "_data",
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    pathPrefix: "/",
  };
};
