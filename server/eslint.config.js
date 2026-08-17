import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // `const { publicToken, ...safe } = device` is how fields are
          // deliberately dropped from a response. The discarded name is
          // unused by design; flagging it would push the codebase
          // towards manual field copying, which is easier to get wrong.
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // The seed script is a CLI: printing is the point.
    files: ["prisma/seed.ts"],
    rules: { "no-console": "off" },
  }
);
