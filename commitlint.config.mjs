/** Conventional Commits config for mochi. See PLAN.md §15.4. */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "chore", "docs", "test", "refactor", "perf", "build", "ci"],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "core",
        "consistency",
        "inject",
        "net",
        "net-rs",
        "behavioral",
        "profiles",
        "harness",
        "cli",
        "repo",
        "docs",
        "schemas",
        "challenges",
      ],
    ],
    "scope-empty": [2, "never"],
    "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
