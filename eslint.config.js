import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "site/**", ".claude/**", "node_modules/**"] },
  eslint.configs.recommended,
  {
    // Type-checked linting for library source.
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Build/test config files are outside the tsconfig project: lint syntactically,
    // without type information.
    files: ["**/*.config.ts"],
    extends: [...tseslint.configs.recommended],
  },
  // Keep last: turn off stylistic rules that would fight Prettier.
  prettier,
);
