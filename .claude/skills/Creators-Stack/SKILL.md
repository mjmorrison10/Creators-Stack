---
name: creators-stack-conventions
description: Development conventions and patterns for Creators-Stack. TypeScript Vite project with conventional commits.
---

# Creators Stack Conventions

> Generated from [mjmorrison10/Creators-Stack](https://github.com/mjmorrison10/Creators-Stack) on 2026-08-08

## Overview

This skill teaches Claude the development patterns and conventions used in Creators-Stack.

## Tech Stack

- **Primary Language**: TypeScript
- **Framework**: Vite
- **Architecture**: feature-based module organization
- **Test Location**: separate
- **Test Framework**: playwright

## When to Use This Skill

Activate this skill when:
- Making changes to this repository
- Adding new features following established patterns
- Writing tests that match project conventions
- Creating commits with proper message format

## Commit Conventions

Follow these commit message conventions based on 51 analyzed commits.

### Commit Style: Conventional Commits

### Prefixes Used

- `feat`
- `docs`
- `fix`
- `test`

### Message Guidelines

- Average message length: ~58 characters
- Keep first line concise and descriptive
- Use imperative mood ("Add feature" not "Added feature")


*Commit message example*

```text
feat: scaffold the unified stack app (Phase 0)
```

*Commit message example*

```text
docs: log Phase 0 and Phase 1 part 1 in the plan file
```

*Commit message example*

```text
fix: address Phase 3 code-review findings
```

*Commit message example*

```text
test: PULSE import rules, and the link-less backup bug fix (Phase 6, parts 1-2)
```

*Commit message example*

```text
ci: clone the legacy apps the differentials diff against
```

*Commit message example*

```text
feat: data-layer foundation for the unified app (Phase 1, part 1)
```

*Commit message example*

```text
feat: port the stack merge engine with differential tests (Phase 1b)
```

*Commit message example*

```text
docs: log Phase 1b in the plan file
```

## Architecture

### Project Structure: Single Package

This project uses **feature-based** module organization.

### Source Layout

```
src/
├── components/
├── data/
├── domain/
├── features/
├── services/
```

### Entry Points

- `src/App.tsx`
- `src/main.tsx`

### Configuration Files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/refresh-leaderboard.yml`
- `package.json`
- `playwright.config.ts`
- `tsconfig.json`
- `vite.config.ts`

### Guidelines

- Group related code by feature/domain
- Each feature folder should be self-contained
- Shared utilities go in a common/shared folder

## Code Style

### Language: TypeScript

### Naming Conventions

| Element | Convention |
|---------|------------|
| Files | camelCase |
| Functions | camelCase |
| Classes | PascalCase |
| Constants | SCREAMING_SNAKE_CASE |

### Import Style: Relative Imports

### Export Style: Named Exports


*Preferred import style*

```typescript
// Use relative imports
import { Button } from '../components/Button'
import { useAuth } from './hooks/useAuth'
```

*Preferred export style*

```typescript
// Use named exports
export function calculateTotal() { ... }
export const TAX_RATE = 0.1
export interface Order { ... }
```

## Testing

### Test Framework: playwright

### File Pattern: `*.test.ts`

### Test Types

- **Unit tests**: Test individual functions and components in isolation
- **E2e tests**: Test complete user flows through the application


## Error Handling

### Error Handling Style: Try-Catch Blocks


*Standard error handling pattern*

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('User-friendly message')
}
```

## Common Workflows

These workflows were detected from analyzing commit patterns.

### Feature Development

Standard feature implementation workflow

**Frequency**: ~20 times per month

**Steps**:
1. Add feature implementation
2. Add tests for feature
3. Update documentation

**Files typically involved**:
- `src/*`
- `src/components/*`
- `src/features/blast/*`
- `**/*.test.*`
- `**/api/**`

**Example commit sequence**:
```
feat: scaffold the unified stack app (Phase 0)
feat: data-layer foundation for the unified app (Phase 1, part 1)
docs: log Phase 0 and Phase 1 part 1 in the plan file
```

### Refactoring

Code refactoring and cleanup workflow

**Frequency**: ~2 times per month

**Steps**:
1. Ensure tests pass before refactor
2. Refactor code structure
3. Verify tests still pass

**Files typically involved**:
- `src/**/*`

**Example commit sequence**:
```
fix: address Phase 3 code-review findings
feat: port the RECALL transcript parser (Phase 4, part 1)
feat: port RECALL library operations — search, bin, exports (Phase 4, part 2)
```


## Best Practices

Based on analysis of the codebase, follow these practices:

### Do

- Use conventional commit format (feat:, fix:, etc.)
- Keep feature code co-located in feature folders
- Write tests using playwright
- Follow *.test.ts naming pattern
- Use camelCase for file names
- Prefer named exports

### Don't

- Don't write vague commit messages
- Don't skip tests for new features
- Don't deviate from established patterns without discussion

---

*This skill was auto-generated by [ECC Tools](https://ecc.tools). Review and customize as needed for your team.*
