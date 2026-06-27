# Installer Refactor — `curl|bash` + `iex` → `npx opencode-moa-fusion`

Plan detallado para unificar los instaladores Linux/macOS/Windows en un único
punto de entrada `npx`, eliminar la verificación de firma sigstore/cosign
(innecesaria una vez que el instalador viaja dentro del propio paquete npm), y
publicar instalador + plugin runtime en una sola `npm publish` desde el mismo
workflow de release.

> Estado: **aprobado**, listo para ejecutar.
> Decisiones tomadas con el usuario:
> 1. Único paquete: **`opencode-moa-fusion`** (sin shim `moa`).
> 2. **Eliminar inmediatamente** `install.sh` e `install.ps1`.
> 3. Conservar la flag **`--command-name=<name>`** para instalaciones CI no interactivas.
> 4. Mantener **`src/install-merge-config.mjs` como subproceso** (no inline).

---

## 0. Resumen ejecutivo

| Antes | Después |
| --- | --- |
| 2 bootstrap wrappers (`install.sh`, `install.ps1`) | 1 bin Node TypeScript: `dist/cli/install.js` |
| 6 descargas remotas durante install (`install-merge-config.mjs`, `moa.md`, `SHA256SUMS`, `.sig`, `.pem`, opcional `npm view`) | 0 descargas remotas durante install — todo en la tarball npm |
| Verificación SHA-256 + cosign (`gh attestation`) sobre `moa.md` | Confianza delegada al hash de integridad del registry npm (mismo modelo que ya usa OpenCode al cargar `dist/index.js`) |
| Env-vars hay que reinyectar (`curl … \| ANTHROPIC_API_KEY=x bash`) | Env-vars heredadas trivialmente (`ANTHROPIC_API_KEY=x npx opencode-moa-fusion`) |
| `--owner`, `--repo`, `--version`, `--download-base-url`, `--skip-signature`, `--command-name` | Solo `--command-name` |
| Workflow de release: sign + upload assets + publish | Workflow de release: build + test + publish (un solo paso de distribución) |

**Resultado para el usuario final**:

```bash
# Linux, macOS, WSL, Git Bash, PowerShell, cmd — todos
npx opencode-moa-fusion@latest

# Con env-vars para providers custom (Anthropic via proxy, etc.)
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
  npx opencode-moa-fusion@latest

# No interactivo (CI / dotfiles)
npx opencode-moa-fusion@latest --command-name=council
```

---

## 1. Distribución: un solo paquete, un solo `npm publish`

El instalador **no es un paquete separado**. Es un segundo punto de entrada
del paquete existente `opencode-moa-fusion`:

- `package.json` declara dos cosas dentro de la misma tarball:
  - `"main": "dist/index.js"` — el plugin runtime cargado por OpenCode
  - `"bin": { "opencode-moa-fusion": "dist/cli/install.js" }` — el CLI ejecutable

- El job `publish` de `.github/workflows/release.yml` ya hace `npm publish` para
  el runtime. Después de este refactor, **ese mismo `npm publish` publica
  también el instalador**, porque ambos están en la misma tarball. No hay que
  añadir un segundo step, ni un segundo paquete, ni un segundo registry.

- `npx opencode-moa-fusion@<v>` resuelve `bin.opencode-moa-fusion`
  automáticamente al tener el mismo nombre que el paquete.

- La versión del instalador **siempre coincide** con la versión del runtime que
  pinea en `opencode.json`. Esto resuelve la clase de bugs donde el instalador
  y el runtime se desalineaban.

**Riesgo descartado**: publicar también en un repositorio alternativo (GitHub
Packages, JSR, etc.) sería trabajo extra sin beneficio — `npx` siempre golpea
npmjs.org por defecto, y los usuarios corporativos con proxies internos ya
están cubiertos por el comportamiento estándar de npm (sección "Installation
issues in corporate environments" del README sigue aplicando).

---

## 2. Modelo de confianza — por qué cae sigstore

### Estado actual

`install.sh` descarga 4 ficheros independientes desde un GitHub Release:

```
commands/moa.md
SHA256SUMS         (lista hash sha256 de moa.md)
SHA256SUMS.sig     (firma cosign keyless sobre SHA256SUMS)
SHA256SUMS.pem     (certificado x509 del OIDC GitHub Actions)
```

La verificación tiene sentido **porque la descarga de `moa.md` es independiente
del registry npm**: si la red, el host de GitHub, o un atacante MITM
manipularan el contenido, el SHA-256 lo detectaría, y la firma cosign acredita
que el SHA-256 fue calculado dentro de un GitHub Actions run del repo correcto
(no por un atacante con acceso a release assets).

### Por qué desaparece

Una vez que `moa.md` viaja **dentro de la tarball npm publicada**:

1. El instalador lee `moa.md` de `<pkg>/commands/moa.md` resuelto via
   `fileURLToPath(import.meta.url)`. **No hay descarga.**
2. La tarball npm la baja `npx` aplicando el `integrity` hash sha512 que el
   registry mantiene para cada versión publicada (`npm install` + lockfiles
   validan esto siempre).
3. El mismo `moa.md` que valida `npm` es el mismo `moa.md` que ya estás
   confiando para cargar `dist/index.js` como plugin con permisos plenos de
   filesystem y red. Si esta cadena de confianza no es suficiente para el
   runtime, sigstore tampoco la arregla para `moa.md`.

Por tanto, eliminamos:
- `SHA256SUMS`, `SHA256SUMS.sig`, `SHA256SUMS.pem` (generación, upload, descarga, verificación)
- Dependencia opcional de `cosign` o `gh` CLI en el host del usuario
- Step `sigstore/cosign-installer@v3` en el workflow
- Permiso `id-token: write` en el workflow (si no se usa para otra cosa)
- Flag `--skip-signature` y todo el código asociado en el instalador

Si en algún momento futuro se quiere **además** publicar attestations de
provenance del paquete npm (npm provenance), eso es una _flag_ aparte
(`npm publish --provenance`) que vive dentro del modelo de npm y no requiere
un instalador customizado.

---

## 3. Cambios por archivo

### 3.1. NUEVO `src/cli/install.ts`

Punto de entrada del bin. ESM TypeScript. Compila a `dist/cli/install.js`.
Reutiliza la lógica del heredoc actual de `install.sh`, simplificada.

**Estructura del fichero** (orden orientativo):

```ts
#!/usr/bin/env node
// src/cli/install.ts
//
// Interactive installer for opencode-moa-fusion. Shipped as the `bin` of
// this npm package. Invoked via:
//
//   npx opencode-moa-fusion@<version> [--command-name=<name>]
//
// All env vars set on the npx invocation are inherited by `opencode models`
// transparently, so providers requiring API keys / custom base URLs work
// without special wiring.

import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync, fsyncSync, renameSync, existsSync, copyFileSync, openSync as _openSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execSync, spawnSync } from "node:child_process";
import readline from "node:readline";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const pkg = require_("../../package.json") as { version: string };
const VERSION = pkg.version;

// Paths inside the installed npm package
const HERE = path.dirname(fileURLToPath(import.meta.url));         // dist/cli
const PKG_ROOT = path.resolve(HERE, "..", "..");                   // package root
const MERGE_SCRIPT = path.join(PKG_ROOT, "src", "install-merge-config.mjs");
const MOA_MD_SOURCE = path.join(PKG_ROOT, "commands", "moa.md");

// ── ANSI colors (same palette as install.sh) ─────────────────────────────
const C = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m",
            yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
            gray: "\x1b[90m", red: "\x1b[31m" } as const;

// ── Command-name validation (regex idéntico al actual) ──────────────────
const DEFAULT_COMMAND_NAME = "moa";
const COMMAND_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
function normalizeCommandName(input: unknown): string | null { /* … */ }

// ── Argv parsing — SOLO --command-name=<name> ───────────────────────────
interface InstallArgs { commandName: string | null; }
function parseArgs(argv: string[]): InstallArgs { /* … */ }

// ── Interactive prompts (idénticos a install.sh, tipados) ───────────────
async function scopePrompt(): Promise<"local" | "global"> { /* … */ }
async function commandNamePrompt(defaultName: string): Promise<string> { /* … */ }
async function multiSelectPrompt(models: string[]): Promise<string[]> { /* … */ }

// ── `opencode models` capture, env-vars heredadas por defecto ───────────
function getOpencodeModels(): string[] {
    try {
        const out = execSync("opencode models", {
            stdio: ["ignore", "pipe", "ignore"],
            // env: process.env  // <-- por defecto, NO hace falta especificarlo
        }).toString();
        return out.split(/\r?\n/).map(l => l.trim())
            .filter(l => l.length > 0 && l.includes("/"));
    } catch { return []; }
}

// ── TTY fallback (por si stdin/stdout son pipes) ────────────────────────
function ensureInteractiveTTY(): void { /* idéntico al actual */ }

// ── Subproceso al merge-config ──────────────────────────────────────────
async function runMergeConfig(configPath: string, pluginSpec: string, workers: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", [
            MERGE_SCRIPT,
            `--config-path=${configPath}`,
            `--plugin-spec=${pluginSpec}`,
            `--workers=${workers.join(",")}`,
        ], { stdio: "inherit" });
        proc.on("error", reject);
        proc.on("close", code => code === 0 ? resolve() : reject(new Error(`merge-config exited ${code}`)));
    });
}

// ── atomicWriteSync (idéntico al actual) ────────────────────────────────
function atomicWriteSync(finalPath: string, bytes: Buffer): void { /* … */ }

// ── main() — flujo total ────────────────────────────────────────────────
async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    ensureInteractiveTTY();

    const scope = await scopePrompt();
    const commandName = args.commandName
        ? (normalizeCommandName(args.commandName) ?? die(`Invalid --command-name`))
        : await commandNamePrompt(DEFAULT_COMMAND_NAME);

    const configPath = scope === "global"
        ? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "opencode.json")
        : path.join(process.cwd(), "opencode.json");
    const cmdDir = scope === "global"
        ? path.join(path.dirname(configPath), "command")
        : path.join(process.cwd(), ".opencode", "command");

    console.log(`${C.blue}Fetching available models...${C.reset}`);
    const models = getOpencodeModels();
    const workers = models.length > 0
        ? await multiSelectPrompt(models)
        : (console.log(`${C.yellow}Could not fetch models. You can add them later.${C.reset}`), []);

    console.log(`${C.blue}Merging plugin entry into ${configPath}...${C.reset}`);
    await runMergeConfig(configPath, `opencode-moa-fusion@${VERSION}`, workers);
    console.log(`${C.green}✓ Updated ${configPath}${C.reset}`);

    console.log(`${C.blue}Installing /${commandName} command...${C.reset}`);
    mkdirSync(cmdDir, { recursive: true });
    const cmdPath = path.join(cmdDir, `${commandName}.md`);
    atomicWriteSync(cmdPath, readFileSync(MOA_MD_SOURCE));
    console.log(`${C.green}✓ Installed /${commandName} command at ${cmdPath}${C.reset}\n`);

    console.log(`${C.bold}All done! Restart OpenCode to use the /${commandName} command.${C.reset}\n`);
}

main().catch(err => {
    console.error(`${C.red}${err.message ?? err}${C.reset}`);
    process.exit(1);
});
```

**Notas de implementación**:

- El shebang debe sobrevivir el paso por TypeScript. Dos opciones probadas:
  (a) declarar `"compilerOptions": { "removeComments": false }` y poner el
  shebang como primera línea — TSC lo preserva si está fuera de comentarios;
  (b) en el build, post-procesar con un script que añade `#!/usr/bin/env node`
  al inicio si no existe. Preferimos (a) por simplicidad.
- `chmod +x` no es necesario al ser distribuido por npm — npm aplica `0755` a
  los ficheros listados en `bin` automáticamente al instalar.
- `import.meta.url` requiere ESM, ya activado en `package.json` (`"type": "module"`).
- `createRequire` es la forma idiomática de cargar `package.json` en ESM sin
  depender del flag experimental `import … with { type: "json" }` (que no es
  estable en todas las Node 18.x).
- `ensureInteractiveTTY()` mantiene el fallback a `/dev/tty` para el caso poco
  común de `cmd | npx opencode-moa-fusion` (stdin redirigido).

### 3.2. `package.json` — diff exacto

```diff
 {
   "name": "opencode-moa-fusion",
-  "version": "1.3.1",
+  "version": "1.4.0",
   "type": "module",
   "main": "dist/index.js",
+  "bin": {
+    "opencode-moa-fusion": "dist/cli/install.js"
+  },
+  "engines": {
+    "node": ">=18"
+  },
   "files": [
     "dist",
     "commands",
-    "install.sh",
-    "install.ps1",
     "src/install-merge-config.mjs"
   ],
   "scripts": { ... },
```

Bump de versión a `1.4.0` (minor) porque cambia el contrato de instalación.
El runtime del plugin (`dist/index.js`) no cambia de API, así que un major no
está justificado, pero un patch sí lo está poco — preferimos minor para
señalar a los usuarios el cambio de método de install.

### 3.3. `tsconfig.build.json`

Confirmar que incluye `src/cli/**/*.ts` en el glob de compilación. Si el
`include` actual es `["src"]` y `outDir` es `dist`, el resultado en
`dist/cli/install.js` sale solo. Verificación post-build:

```bash
bun run build
ls -la dist/cli/install.js   # debe existir, modo 0644 (npm lo cambia a 0755 al instalar)
head -1 dist/cli/install.js  # debe ser: #!/usr/bin/env node
```

### 3.4. Archivos borrados

```
install.sh
install.ps1
src/install-verify.mjs
src/install-verify.d.mts
tests/install_signature.sh
tests/install_signature_e2e.mjs
tests/install_signature_e2e.spec.ts
tests/install-verify.spec.ts
```

### 3.5. `.github/workflows/release.yml` — diff

```diff
 name: Release

 on:
   push:
     tags:
       - 'v*'

 permissions:
-  id-token: write   # required for OIDC → cosign keyless signing
   contents: write   # required to upload release assets

 jobs:
   publish:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4

       - uses: actions/setup-node@v4
         with:
           node-version: 20
           registry-url: https://registry.npmjs.org/

       - uses: oven-sh/setup-bun@v2
         with:
           bun-version: latest

-      - uses: sigstore/cosign-installer@v3
-
       - run: bun install
       - run: bun run build
       - run: bun test

-      - name: Compute SHA256SUMS for code-execution artefacts
-        working-directory: commands
-        run: |
-          sha256sum moa.md > ../SHA256SUMS
-
-      - name: Sign SHA256SUMS (cosign keyless, OIDC from GitHub Actions)
-        env:
-          COSIGN_EXPERIMENTAL: '1'
-        run: |
-          cosign sign-blob --yes \
-            --output-signature SHA256SUMS.sig \
-            --output-certificate SHA256SUMS.pem \
-            SHA256SUMS
-
-      - name: Upload release assets
-        uses: softprops/action-gh-release@v2
-        with:
-          files: |
-            commands/moa.md
-            SHA256SUMS
-            SHA256SUMS.sig
-            SHA256SUMS.pem
-
       - run: npm publish --no-git-checks
         env:
           NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Si quieres conservar **el GitHub Release como tag visible en la página de
releases** (aunque sin assets), se puede mantener un `softprops/action-gh-release@v2`
sin `files:` que solo cree el release vacío. Recomendación: dejarlo, porque el
CHANGELOG sigue siendo útil verlo en la pestaña Releases. Lo bajamos en el
mismo PR si te molesta.

**Importante**: el único step de distribución a npmjs es `npm publish`, y ese
step **publica el plugin y el instalador a la vez** porque ambos viven en la
misma tarball generada por `npm pack`. No hay que añadir nada nuevo al
workflow para publicar el instalador.

### 3.6. NUEVO `tests/cli-install.spec.ts`

Cubre el flujo del nuevo bin sin tocar npm ni internet. Casos:

1. **`parseArgs`**:
   - `--command-name=team` → `commandName: "team"`
   - `--command-name=Council` → debe rechazarse (mayúsculas no permitidas)
   - sin args → `commandName: null`
   - flag desconocida → ignorada silenciosamente (compatibilidad hacia atrás)
2. **`normalizeCommandName`**:
   - `/team` → `team`
   - `MOA` → `null`
   - cadena de 33 chars → `null`
3. **`getOpencodeModels` propaga env**: en una shell de test,
   `PATH=$tmpdir:$PATH` con un script `opencode` que ecoa
   `process.env.TEST_TOKEN`. Asserts: la salida capturada contiene
   `TEST_TOKEN=expected`.
4. **E2E contra tmpdir**:
   - Generar `opencode.json` fixture con plugins preexistentes
   - `process.cwd = tmpdir`, ejecutar `main()` con `--command-name=test` y
     stdin scriptado que selecciona scope=local y 0 workers
   - Asserts:
     - `tmpdir/opencode.json` tiene `plugin: [..., ["opencode-moa-fusion@<v>", {}]]`
     - `tmpdir/.opencode/command/test.md` existe y tiene el mismo contenido que
       `commands/moa.md` del repo
     - `tmpdir/opencode.json.bak.<ts>` existe

Mantener:
- `tests/commandName.spec.ts` (lógica pura, se reutiliza)
- `tests/install-merge-config.spec.ts` (subproceso sigue existiendo)

### 3.7. `README.md` — reescritura de las secciones afectadas

**Sustituir** Installation por:

````markdown
## Installation

```bash
# Linux, macOS, Windows (todas las shells)
npx opencode-moa-fusion@latest
```

El instalador interactivo te preguntará:
1. Scope: local (`./opencode.json`) o global (`~/.config/opencode/opencode.json`).
2. Nombre del slash command (default: `moa`).
3. Selección multi-selección de los modelos worker desde `opencode models`.

Luego mergea la entrada del plugin en tu `opencode.json` (con backup
timestamped) e instala el slash command en el directorio correspondiente.

### Variables de entorno para providers custom

Las env-vars en la línea de `npx` se heredan al subproceso `opencode models`,
así que provedores que requieran credenciales o base URLs custom funcionan
directamente:

```bash
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:3456 \
  npx opencode-moa-fusion@latest
```

### Modo no interactivo (CI / dotfiles)

```bash
npx opencode-moa-fusion@latest --command-name=council
```

`--command-name` acepta `^[a-z][a-z0-9_-]{0,31}$` (igual que antes).

### Pinning de versión

`npx opencode-moa-fusion@<version>` pinea la versión del instalador, y esa
misma versión es la que queda escrita en `opencode.json` como
`opencode-moa-fusion@<version>`. Ver §Registration sobre por qué nunca usar
`@latest` _en el `opencode.json` final_ (lo de `npx` arriba es solo para
ejecutar el instalador una vez).

### Instalación manual del runtime

```bash
npm install -g opencode-moa-fusion@1.4.0
# o
bun add -g opencode-moa-fusion@1.4.0
```
````

**Eliminar de README**:
- Bloque PowerShell separado (queda cubierto por `npx`)
- "Windows note" sobre PowerShell + TTY
- Disclaimer sobre orden `ANTHROPIC_API_KEY=x bash` vs `curl` (irrelevante)
- En "Troubleshooting", la línea sobre `--skip-signature` y la nota sobre
  `cosign` / `gh attestation`

**Conservar**:
- "Installation issues in corporate environments" — sigue aplicando al runtime
  que OpenCode descarga por su cuenta cuando carga el plugin (`~/.cache/opencode/packages/…`).
- "Registration", "Plugin options", "workerTools", "Always pin a specific version"
- "Usage" + "Slash Command (recommended)" + "Tool Arguments"
- "Output Format", "Troubleshooting" (menos la parte de signature),
  "Session Cleanup", "Examples", "Development"

### 3.8. `CHANGELOG.md` — nueva entrada `1.4.0`

```markdown
## 1.4.0

### Breaking changes

- **Installation moved to `npx opencode-moa-fusion`**. The `install.sh` /
  `install.ps1` one-liners have been removed. Old usage:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
  ```
  New usage (works on Linux, macOS, Windows):
  ```bash
  npx opencode-moa-fusion@latest
  ```
- Sigstore / cosign signature verification removed. The installer no longer
  downloads `moa.md` from a GitHub Release — it reads it from the installed npm
  package, whose integrity is verified by npm itself.
- Flags removed from the installer: `--owner`, `--repo`, `--version`,
  `--download-base-url`, `--skip-signature`. Flag kept: `--command-name`.

### Migration

Old:
```bash
curl -fsSL https://.../install.sh | ANTHROPIC_API_KEY=x bash -s -- --skip-signature
```
New:
```bash
ANTHROPIC_API_KEY=x npx opencode-moa-fusion@latest
```
```

### 3.9. `RELEASING.md`

Quitar referencias a SHA256SUMS, cosign, gh attestation, y al bloque de
"Upload release assets". El flujo queda:

1. `git tag v1.4.0 && git push --tags`
2. El workflow `release.yml` corre: build + tests + `npm publish`
3. La nueva versión es invocable inmediatamente con `npx opencode-moa-fusion@1.4.0`

---

## 4. Verificación post-implementación (gate antes de merge)

Pasos a ejecutar en orden:

```bash
# 1. Build
bun run build
test -x dist/cli/install.js  # falla en local porque chmod no se aplica hasta el install de npm
head -1 dist/cli/install.js  # debe imprimir: #!/usr/bin/env node

# 2. Lint + type-check
bun run check
bun run typecheck

# 3. Tests (suite verde, sin tests de signature)
bun test

# 4. Verificar contenido de la tarball
npm pack --dry-run 2>&1 | grep -E "install\.(sh|ps1)|SHA256SUMS"  # debe ser vacío
npm pack --dry-run 2>&1 | grep -E "dist/cli/install\.js|commands/moa\.md|src/install-merge-config\.mjs"  # las 3 deben aparecer

# 5. Smoke test end-to-end en tmpdir
TMPDIR=$(mktemp -d)
cd $TMPDIR
echo '{"plugin": []}' > opencode.json
node $REPO_ROOT/dist/cli/install.js --command-name=smoketest
# debe imprimir el flujo completo y crear .opencode/command/smoketest.md

# 6. Verificar env-vars propagadas
TEST_VAR=hello node -e 'require("child_process").execSync("env | grep TEST_VAR", {stdio: "inherit"})'

# 7. (Opcional pero recomendado) Smoke test desde la tarball real
cd $(mktemp -d)
echo '{"plugin": []}' > opencode.json
npm pack $REPO_ROOT  # produce opencode-moa-fusion-1.4.0.tgz
npx ./opencode-moa-fusion-1.4.0.tgz --command-name=tarball
```

---

## 5. Orden de implementación recomendado

PRs / commits separados para facilitar revisión y rollback:

1. **commit 1 — añadir nuevo bin sin tocar nada viejo**
   - Crear `src/cli/install.ts`
   - Actualizar `package.json` con `bin`, `engines`, version 1.4.0
   - Añadir `tests/cli-install.spec.ts`
   - Verificar que `bun run build && bun test` pasa
   - En este punto coexisten ambos métodos de install

2. **commit 2 — borrar instaladores viejos**
   - Borrar `install.sh`, `install.ps1`
   - Borrar `src/install-verify.{mjs,d.mts}`
   - Borrar `tests/install_signature*` y `tests/install-verify.spec.ts`
   - Quitar `install.sh` / `install.ps1` de `package.json#files`

3. **commit 3 — actualizar workflow**
   - Aplicar diff de `.github/workflows/release.yml`
   - Verificar localmente con `act` (opcional) o dejarlo para el primer push

4. **commit 4 — README + CHANGELOG + RELEASING**
   - Reescribir las secciones del README listadas en §3.7
   - Añadir entrada `1.4.0` en CHANGELOG
   - Limpiar RELEASING.md

5. **tag v1.4.0** → el workflow corre → `npm publish` → `npx opencode-moa-fusion@1.4.0`
   pasa a estar vivo.

---

## 6. Decisiones pendientes (no bloquean ejecución, se pueden tomar en PR)

- ¿Crear release vacío en GitHub Releases tras eliminar los assets, o eliminar
  por completo el step `softprops/action-gh-release`? **Recomendación**: dejar
  release vacío con notas autogeneradas (`generate_release_notes: true`) por
  el valor histórico de la pestaña Releases.
- ¿Añadir `npm publish --provenance` en el workflow? Es ortogonal a este
  refactor, pero ahora que retiramos sigstore/cosign sería una sustitución
  natural — npm provenance está estable y es el mecanismo "first-class" para
  attestations en el ecosistema. **Recomendación**: hacerlo en un PR siguiente,
  no en este.
- ¿`engines.node: >=18` o `>=20`? Bun 1.x corre con Node 18+, GitHub Actions
  ya usa Node 20 en el workflow. **Recomendación**: `>=18` para no excluir
  usuarios con LTS antiguas innecesariamente.
