/** Bind supported hosts to source-derived SDK calls and published first-release evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import test from "node:test";
import { checkExtensionManifestCompatibility } from "@unbrained/pm-cli/sdk";
import * as syntax from "typescript/unstable/ast";
import { API, SignatureKind, SymbolFlags, type Symbol as CompilerSymbol } from "typescript/unstable/sync";

/** One published capability required by the package's runtime source. */
interface Capability {
  readonly kind: "export" | "member";
  readonly module: string;
  readonly name: string;
  readonly first: string;
  readonly previous: string | null;
  readonly sha256: string;
  readonly previousSha256: string | null;
  readonly uses: readonly string[];
}

const root = resolve(import.meta.dirname, "..");
const evidence = JSON.parse(readFileSync(resolve(root, "docs/sdk-floor.json"), "utf8")) as { readonly apis: readonly Capability[] };

/** Identify a capability independently of source line movement. */
function key(api: Pick<Capability, "kind" | "module" | "name">): string {
  return `${api.kind}:${api.module}:${api.name}`;
}

/** Compare calendar versions numerically, including unpadded month/day components. */
function compare(left: string, right: string): number {
  assert.match(left, /^\d+\.\d+\.\d+$/);
  assert.match(right, /^\d+\.\d+\.\d+$/);
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

/** Exclude test/build tooling and erased declarations from the runtime import graph. */
function runtime(file: string): boolean {
  return /\.tsx?$/.test(file) && !file.endsWith(".d.ts")
    && !/(?:^|\/)(?:test|tests|scripts|examples|dist|dist-test|node_modules|public|\.agents)\//.test(relative(root, file).replaceAll("\\", "/"));
}

/** Resolve SDK aliases and loader signatures without importing package runtime code. */
function collect(): string[] {
  const compiler = new API({ cwd: root });
  try {
    const config = resolve(root, "tsconfig.json");
    const snapshot = compiler.updateSnapshot({ openProjects: [config] });
    try {
      const project = snapshot.getProject(config);
      assert.ok(project, "the runtime TypeScript project must load");
      const { program, checker } = project;
      const found = new Set<string>();
      /** Add a public export or a member of its declared host contract. */
      function add(kind: Capability["kind"], module: string, name: string): void {
        found.add(key({ kind, module, name }));
      }
      /** Follow a public re-export to its real declaration. */
      function declaration(symbol: CompilerSymbol | undefined): syntax.Node | undefined {
        if (symbol && (symbol.flags & SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
        return symbol?.declarations.find(node => node.path.replaceAll("\\", "/").includes("/@unbrained/pm-cli/"))?.resolve();
      }
      /** Retain subpath identity for SDK namespaces returned by lazy loaders. */
      function moduleFor(node: syntax.Node): string {
        const symbol = checker.getTypeAtLocation(node)?.getSymbol();
        const file = symbol?.declarations[0]?.path.replaceAll("\\", "/") ?? "";
        const match = file.match(/\/sdk\/([^/]+)\.d\.ts$/);
        return match && match[1] !== "index" ? `/sdk/${match[1]}` : "/sdk";
      }
      /** Walk actual source symbols, so renaming a client or passing it through a helper is covered. */
      function visit(node: syntax.Node): void {
        if (syntax.isImportDeclaration(node) && syntax.isStringLiteral(node.moduleSpecifier)
          && node.moduleSpecifier.text.startsWith("@unbrained/pm-cli")) {
          const clause = node.importClause;
          const module = node.moduleSpecifier.text.replace("@unbrained/pm-cli", "") || "/";
          if (clause?.namedBindings && syntax.isNamedImports(clause.namedBindings)) {
            for (const name of clause.namedBindings.elements) {
              const alias = checker.getSymbolAtLocation(name.name);
              const target = alias && checker.getAliasedSymbol(alias);
              // Value types also describe real functions/constructors used by typed require loaders.
              if ((clause.phaseModifier !== syntax.SyntaxKind.TypeKeyword && !name.isTypeOnly) || target?.valueDeclaration) {
                add("export", module, (name.propertyName ?? name.name).text);
              }
            }
          }
        }
        if (syntax.isVariableDeclaration(node) && syntax.isObjectBindingPattern(node.name) && node.initializer) {
          const type = checker.getTypeAtLocation(node.initializer);
          const namespace = type?.getSymbol()?.declarations.some(handle => {
            const source = handle.resolve();
            return handle.path.replaceAll('\\', '/').includes('/@unbrained/pm-cli/') && source !== undefined && syntax.isSourceFile(source);
          });
          if (type && namespace) for (const binding of node.name.elements) {
            const name = (binding.propertyName ?? binding.name)?.getText();
            if (name === undefined) continue;
            if (declaration(checker.getPropertyOfType(type, name))) add("export", moduleFor(node.initializer), name);
          }
        }
        if (syntax.isPropertyAccessExpression(node) || syntax.isElementAccessExpression(node) || syntax.isQualifiedName(node)) {
          const name = syntax.isQualifiedName(node) ? node.right
            : syntax.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
          const symbol = checker.getSymbolAtLocation(name);
          const source = declaration(symbol);
          if (source && symbol && !syntax.isIndexSignatureDeclaration(source)) {
            let owner = source.parent;
            if (syntax.isVariableDeclaration(source)) owner = source.parent.parent;
            if (syntax.isTypeLiteralNode(owner) && syntax.isTypeAliasDeclaration(owner.parent)) owner = owner.parent;
            const type = checker.getTypeAtLocation(node);
            const callable = type && checker.getSignaturesOfType(type, SignatureKind.Call).length > 0;
            if ((syntax.isClassDeclaration(owner) || syntax.isInterfaceDeclaration(owner) || syntax.isTypeAliasDeclaration(owner)) && owner.name) {
              if (callable || /Context$|^ExtensionCommandSdk$|^ExtensionApi$|^PmClient$/.test(owner.name.text)) {
                const receiver = syntax.isQualifiedName(node) ? node.left : node.expression;
                const receiverName = checker.getTypeAtLocation(receiver)?.getSymbol()?.name;
                const contract = owner.name.text === "PortableWorkspaceContext" && receiverName && /Context$/.test(receiverName) ? receiverName : owner.name.text;
                add("member", contract, symbol.name);
              }
            } else if ((syntax.isFunctionDeclaration(source) || syntax.isClassDeclaration(source) || syntax.isVariableDeclaration(source)) && (callable || syntax.isClassDeclaration(source))) {
              add("export", moduleFor(syntax.isQualifiedName(node) ? node.left : node.expression), symbol.name);
            }
          }
        }
        node.forEachChild(visit);
      }
      const files = program.getSourceFileNames().filter(file => file.startsWith(root + sep) && runtime(file));
      assert.ok(files.length > 0, "an empty source scan cannot certify SDK compatibility");
      for (const file of files) {
        const source = program.getSourceFile(file);
        assert.ok(source);
        visit(source);
      }
      return [...found].sort();
    } finally {
      snapshot.dispose();
    }
  } finally {
    compiler.close();
  }
}

test("every SDK call has committed first-release evidence checked against runtime source", () => {
  const expected = evidence.apis.map(key).sort();
  assert.equal(new Set(expected).size, expected.length, "capability evidence must be unique");
  assert.deepEqual(collect(), expected, "SDK usage changed: inspect published artifacts, update the capability table, and raise floors when required");
});

test("both enforced floors cover every SDK capability in the source-checked table", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as { readonly pm_min_version: string };
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { readonly peerDependencies?: Readonly<Record<string, string>> };
  const peer = packageJson.peerDependencies?.["@unbrained/pm-cli"];
  assert.ok(peer);
  assert.match(peer, /^>=\d+\.\d+\.\d+$/);
  assert.equal(manifest.pm_min_version, peer.slice(2));
  for (const api of evidence.apis) {
    assert.ok(compare(manifest.pm_min_version, api.first) >= 0, `${key(api)} first ships in ${api.first}; manifest floor ${manifest.pm_min_version} admits incompatible hosts`);
    assert.ok(compare(peer.slice(2), api.first) >= 0, `${key(api)} exceeds the npm peer floor`);
    assert.match(api.sha256, /^[a-f\d]{64}$/);
    assert.ok(api.uses.length > 0);
    if (api.previous !== null) {
      assert.ok(compare(api.previous, api.first) < 0);
      assert.match(api.previousSha256 ?? "", /^[a-f\d]{64}$/);
    }
  }
});


test("the real host manifest gate accepts the declared floor and blocks the missing-API release", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as { readonly pm_min_version: string };
  const highest = evidence.apis.reduce((left, right) => compare(left.first, right.first) >= 0 ? left : right);
  assert.ok(highest.previous, "the required capability has an adjacent negative artifact");
  const accepted = checkExtensionManifestCompatibility(manifest, { pmVersion: manifest.pm_min_version });
  assert.equal(accepted.compatible, true);
  const refused = checkExtensionManifestCompatibility(manifest, { pmVersion: highest.previous });
  assert.equal(refused.compatible, false);
  assert.ok(refused.findings.some(finding => finding.code === "pm_min_version_unmet" && finding.severity === "error"));
});
