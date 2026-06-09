/**
 * Dependency Graph Builder — extracts import/require relationships from source files
 * to enable cross-file impact analysis.
 */

import type { DependencyGraph, DependencyEdge, FileChange } from '@/styles/types/analysis';

/** Regex patterns for import statements by language */
const IMPORT_PATTERNS: Record<string, RegExp> = {
  typescript: /import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+|\s*[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
  javascript: /(?:import\s+(?:\{[^}]*\}|[\w*]+|\s*[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
  python: /(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/g,
  go: /"([^"]+)"/g, // Inside import blocks
  rust: /use\s+([\w:]+(?:::\w+)*);/g,
};

/**
 * Extract imports from a file's source content.
 * Returns array of imported module paths (relative or package).
 */
export function extractImports(
  content: string,
  language: string,
): string[] {
  const pattern = IMPORT_PATTERNS[language];
  if (!pattern) return [];

  const imports: string[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  pattern.lastIndex = 0;

  while ((match = pattern.exec(content)) !== null) {
    const imported = match[1] || match[2]; // Different capture groups per pattern
    if (imported && !imported.startsWith('.')) {
      // Only include relative imports (skip node_modules/package imports)
      continue;
    }
    if (imported) {
      imports.push(imported);
    }
  }

  return [...new Set(imports)]; // Deduplicate
}

/**
 * Resolve a relative import path to a file path within the repo.
 */
export function resolveImportPath(
  fromFile: string,
  importPath: string,
): string | null {
  if (!importPath.startsWith('.')) return null; // Not a relative import

  const fromDir = fromFile.split('/').slice(0, -1).join('/');

  // Resolve relative path
  const parts = importPath.split('/');
  const resolved = fromDir ? fromDir.split('/') : [];

  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }

  const resolvedPath = resolved.join('/');
  // Try common extensions
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
  return resolvedPath; // Return base path; caller decides on extension
}

/**
 * Build a dependency graph from changed files and their imports.
 */
export function buildDependencyGraph(
  fileChanges: FileChange[],
  fileContents: Map<string, string>,
): DependencyGraph {
  const edges: DependencyEdge[] = [];
  const changedPaths = new Set(fileChanges.map((f) => f.file));
  const externalDependents = new Set<string>();

  for (const fc of fileChanges) {
    const content = fileContents.get(fc.file);
    if (!content) continue;

    const lang = detectLanguage(fc.file);
    const imports = extractImports(content, lang);

    for (const imp of imports) {
      const resolved = resolveImportPath(fc.file, imp);
      if (!resolved) continue;

      // Find the actual file with extension in the change list
      const actualPath = findActualFile(resolved, changedPaths);
      if (actualPath) {
        edges.push({
          from: fc.file,
          to: actualPath,
          type: 'import',
        });
      } else {
        // This import points to a file NOT in the change list
        // That file might be affected by changes in the imported module
        externalDependents.add(resolved);
      }
    }
  }

  // Find external files that depend on changed files
  // (reverse lookup: which unchanged files import changed files?)
  for (const fc of fileChanges) {
    // If any externalDependent path matches this changed file's location
    for (const extDep of externalDependents) {
      if (extDep === fc.file.replace(/\.[^.]+$/, '') || extDep.startsWith(fc.file)) {
        externalDependents.add(extDep);
      }
    }
  }

  return {
    edges,
    externalDependents: [...externalDependents],
  };
}

function findActualFile(basePath: string, knownFiles: Set<string>): string | null {
  // Try exact match first
  if (knownFiles.has(basePath)) return basePath;

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (knownFiles.has(withExt)) return withExt;
  }

  // Try index files
  for (const ext of extensions) {
    const indexFile = basePath + '/index' + ext;
    if (knownFiles.has(indexFile)) return indexFile;
  }

  return null;
}

function detectLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  };
  return map[ext] || 'typescript';
}
