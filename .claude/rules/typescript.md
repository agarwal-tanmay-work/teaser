# TypeScript Rules
1. NEVER use `any` — use `unknown` then narrow, or define interface
2. All parameters and return types must be explicitly typed
3. Use `interface` for objects, `type` for unions and primitives
4. All async functions return Promise<T> with explicit T
5. Use optional chaining (?.) for nested property access
6. Use nullish coalescing (??) not logical OR (||) for defaults
7. Strict mode in tsconfig — never disable any strict option
8. No type assertions (as Type) unless absolutely unavoidable
9. Export all interfaces from /types/index.ts — never define
   types inline in component files or route files
