

<p align="center">
<img src="resources/logo_interAGt.svg" alt="logo" width="60%" />
</p>

<p align="center">
<a href="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-macos.yml"><img src="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-macos.yml/badge.svg" alt="Build macOS DMG" /></a>
<a href="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-windows.yml"><img src="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-windows.yml/badge.svg" alt="Build Windows installer" /></a>
<a href="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-linux.yml"><img src="https://github.com/Timniem/ag_streamlit_app/actions/workflows/build-linux.yml/badge.svg" alt="Build Linux AppImage" /></a>
</p>

## **InterAGt: An interactive interface for predicting genetic variant effects using AlphaGenome**
![](resources//interAGt.gif)
## **About**

InterAGt provides an intuitive way to **visualize and interpret the functional impact of genetic variants** using [AlphaGenome](https://www.alphagenomedocs.com), Google DeepMind's state-of-the-art model for predicting regulatory effects from DNA sequences.

**Supported input formats:**
- **HGVS notation** (e.g., `NC_000001.11:g.169549811C>T`)
- **SNP IDs (rsIDs)** (e.g., `rs1234567`)
- **Genomic coordinates** (e.g., `chr1:169549811:C:T`)

AlphaGenome analyzes sequences up to **1 million base pairs** and predicts **11 types of genomic tracks** (e.g., gene expression, chromatin accessibility, splicing) across thousands of tissue and cell-type contexts.

By inputting a variant, researchers can:
- Compare **reference vs. alternative allele tracks** for any variant
- Analyze impacts on **RNA-seq, ATAC, ChIP-seq, splicing, and more**
- Select from **ontology-annotated tissues/cell types** (e.g., `UBERON:0002048` for lung)
- **No coding required**: Access cutting-edge predictions through a user-friendly interface


## **References**
- Žiga Avsec, Natasha Latysheva, Jun Cheng, *et al.* **Advancing regulatory variant effect prediction with AlphaGenome.** *Nature*, 649(8099):1206–1218, 2026. [DOI:10.1038/s41586-025-10014-0](https://doi.org/10.1038/s41586-025-10014-0)

For more details, see the [AlphaGenome Documentation](https://www.alphagenomedocs.com)



## Quick start

### Windows
- Download latest Windows release [here](todo)
- Double click to open **InterAGt-Setup.zip** and extract it
- Double click **InterAGt-Setup.exe**
- Follow the steps and click **Install**
- Click **Finish** with **Launch InterAGt** ticked on
- Windows Defender Firewall may warn and block app components, click **Allow access**
- InterAGT will now run, next time you can start it directly via shortcut or install folder.

### macOS
- Download latest macOS release
  - If you have an M1 or better, download the [arm64](todo) version
  - If you have an older Intel based Mac, download the [x86_64](todo) version
- Double click to extract **InterAGt-DMG-arm64.zip** (or **InterAGt-DMG-x86_64.zip**)
- Double click to open **InterAGt-arm64.dmg** (or **InterAGt-x86_64.dmg**)
- In the popup window, drag **InterAGT.app** into **Applications**
- Find **InterAGt.app** in **Applications** and double click to open
- You will probably get the following warning:
```
InterAGt.app” Not Opened  
Apple could not verify “InterAGt.app” is free of malware that may harm your Mac or compromise your privacy.
```
- Click **Done**
- Go to your **System Settings** and then to **Privacy & Security**
- Scroll down to where it says `InterAGt.app was blocked to protect your Mac`, click **Open Anyway** and again **Open Anyway** in the popup
- Use your admin password or Touch ID to continue
- InterAGT will now run, next time you can start it from Applications directly.

## **Full setup & installation instructions**

### **Option 1: Pre-built Binaries**
The easiest way to get started is to use one of the pre-compiled executables. No Python, Bun, or additional dependencies are required.

Pre-compiled binaries for Windows, macOS (arm64 and Intel), and Linux (x86_64 and arm64) are built by [GitHub Actions](.github/workflows/) and published two ways:
- **Releases**: each published [GitHub Release](https://github.com/Timniem/ag_streamlit_app/releases) has `InterAGt-Setup.exe`, `InterAGt-arm64.dmg`, `InterAGt-x86_64.dmg`, `InterAGt-x86_64.AppImage`, and `InterAGt-aarch64.AppImage` attached — this is the recommended download location.
- **Manual builds**: any workflow can also be triggered on demand from the [Actions tab](https://github.com/Timniem/ag_streamlit_app/actions) (`Run workflow`), producing artifacts downloadable from that run for 90 days without needing a release.

After downloading:

Extract the archive (macOS: mount the DMG; Windows: run the installer; Linux: `chmod +x InterAGt-*.AppImage` and run it).
Launch the executable and the app will open in its own window (backed by `http://localhost:8000`).

**Linux notes:**
- The AppImage is self-contained — it bundles Qt WebEngine, so no system WebKit/GTK packages are needed.
- The **x86_64** build requires glibc 2.35+ (Ubuntu 22.04+, Debian 12+, RHEL 9+). The **arm64** build requires glibc 2.39+ (Ubuntu 24.04+, Debian 13+), because Qt publishes no older arm64 wheels.
- If the AppImage fails to start with a FUSE error, either install `libfuse2` or run it as `./InterAGt-x86_64.AppImage --appimage-extract-and-run`.

---
### **Option 2: Run Directly (Recommended for Development)**

**Prerequisites:**
- Python 3.12+
- [Bun](https://bun.sh/) (for frontend development)

**Run in production mode:**
```bash
python app_launcher.py
```

**Run in preview mode** (serves the last built frontend on its own port, no rebuild needed):
```bash
python app_launcher.py --dev
```

Both open a native app window (via `pywebview`), backed by:
- Production: `http://localhost:8000`
- Preview: Frontend at `http://localhost:4173`, Backend at `http://localhost:8000`

For live frontend reload (HMR) while editing, run the frontend and backend dev servers directly instead:
```bash
cd frontend && bun run dev       # http://localhost:5173, hot reload
.venv/bin/uvicorn backend.main:app --reload   # http://localhost:8000
```

---

### **Option 3: Install via PyInstaller (Standalone Executable)**

**Prerequisites:**
- Python 3.12+
- PyInstaller: `pip install pyinstaller`

**macOS:**
```bash
./packaging/build_mac.sh
```
Produces `dist/InterAGt.app` (and `dist/InterAGt/` unbundled).

**Windows:**
```powershell
.\packaging\build_win.ps1
```
Produces `dist\InterAGt\InterAGt.exe`.

**Linux:**
```bash
pip install "pywebview[qt]"   # Linux has no OS-provided webview; Qt supplies one
./packaging/build_linux.sh
```
Produces `dist/InterAGt/InterAGt`.

**To wrap the build into an installer** (`dist/InterAGt.dmg` on macOS via `hdiutil`, `dist\InterAGt-Setup.exe` on Windows via [Inno Setup 6](https://jrsoftware.org/isdl.php), `dist/InterAGt.AppImage` on Linux via [appimagetool](https://github.com/AppImage/appimagetool), downloaded automatically):
```bash
./packaging/package_mac.sh       # macOS
.\packaging\package_win.ps1      # Windows
./packaging/package_linux.sh     # Linux
```
These builds are unsigned — macOS Gatekeeper / Windows SmartScreen will warn on first launch.

---

### **Option 4: Manual Setup**

For manual setup:

```bash
# Clone the repository
git clone https://github.com/Timniem/ag_streamlit_app
cd ag_streamlit_app

# Install dependencies
pip install --upgrade pip
pip install -r backend/requirements.txt

# Build frontend
cd frontend
bun install
bun run build

# Run the app
cd ..
python app_launcher.py
```